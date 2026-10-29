// 诗词 API 客户端（浏览器直接请求，不经任何中转）
// · 主诗库：snowtraces/poetry-source 公共接口（Cloudflare Workers + D1，53 万首，简体）
//     搜索 /works?q=（标题、作者，至少 2 个字）、诗人 /authors?q= → /authors/:id/works、随机 /works/random
// · 备用：诗泉 palemoky/chinese-poetry-api 公共实例 —— 主诗库连不上 / 5xx / 429 时用于随机与 3 字以上搜索；
//     单字「月」这类查询主诗库不支持，改从备用随机抽几首含这个字的诗（飞花令式结果）
// · 全唐诗 / 全宋诗：chinese-poetry 数据集（cp.js）—— 主诗库几乎没有唐诗、宋诗，「某某的诗」、随机某位诗人、诗名搜索都并入这里的作品；
// · 页面加载不发请求；搜索、诗人目录、朝代结果缓存在内存 + localStorage；
// · 主诗库按 IP 每分钟 60 次：客户端排队节流（每分钟最多 50 次、3 秒内最多 6 次），429 时按 Retry-After 冷却。
import * as store from "./store.js";
import * as zh from "./zh.js";
import * as cp from "./cp.js";

const RAW = window.YINSHI_CONFIG || {};
const PRIMARY = Object.assign({
  name: "snowtraces", base: "https://poetry-api.snowtraces.com/v1",
  limits: [{ windowMs: 60000, max: 50 }, { windowMs: 3000, max: 6 }], maxWaitMs: 5000, cooldownMs: 60000, timeoutMs: 10000,
}, RAW.PRIMARY || {});
const FALLBACK = Object.assign({
  name: "palemoky", base: "https://poetry.palemoky.com/api",
  limits: [{ windowMs: 20000, max: 5 }], maxWaitMs: 4000, cooldownMs: 90000, timeoutMs: 12000, minSearch: 3,
}, RAW.FALLBACK || {});
const PAGE_SIZE = Math.min(50, RAW.PAGE_SIZE || 30);
const AUTHOR_PAGE_SIZE = Math.min(50, RAW.AUTHOR_PAGE_SIZE || 50);
const CHAR_SAMPLES = RAW.CHAR_SAMPLES || 3;
const DOWN_MS = 10 * 60e3;
const DAY = 864e5;

// 主诗库的体裁：界面显示「诗 / 词 / 曲」
export const TYPES = { 诗: "poetry", 词: "ci", 曲: "qu" };
const TYPE_NAME = { poetry: "诗", ci: "词", qu: "曲", other: "" };
// 朝代按时间排序；旧版筛选里保存的诗泉朝代名换成主诗库的叫法
export const DYN_ORDER = ["秦", "汉", "三国", "晋", "南北朝", "隋", "唐", "五代十国", "宋", "金", "元", "明", "清"];
export const DYN_FROM_OLD = { 先秦: "秦", 两汉: "汉", 魏晋: "晋", 五代: "五代十国" };
const DYN_TO_PALEMOKY = { 秦: "先秦", 汉: "两汉", 三国: "魏晋", 晋: "魏晋", 五代十国: "五代" };
const TYPE_TO_PALEMOKY = { ci: "宋词", qu: "元曲" };

let LANG = "zh-Hans";
export function setLang(l) { LANG = l === "zh-Hant" ? "zh-Hant" : "zh-Hans"; }
export function getLang() { return LANG; }
const langTag = () => (LANG === "zh-Hant" ? "hant" : "hans");
const simp = (s) => (zh.ready() ? zh.t2s(String(s || "")) : String(s || ""));      // 主诗库只收简体查询
const forPalemoky = (s) => (LANG === "zh-Hant" && zh.ready() ? zh.s2t(simp(s)) : simp(s));

const memCache = new Map();
const recent = new Map();     // 实例名 → 最近请求时间戳

export class ApiError extends Error {
  constructor(kind, message, status = 0, raw = "") { super(message); this.kind = kind; this.status = status; this.raw = raw; }
}

function url(src, path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    (Array.isArray(v) ? v : [v]).forEach((one) => one !== "" && one != null && qs.append(k, one));
  }
  const s = qs.toString();
  return src.base.replace(/\/$/, "") + path + (s ? "?" + s : "");
}

function cdKey(src) { return "cooldown:" + src.name; }
export function cooldownLeft() {
  return Math.max(0, ...[PRIMARY, FALLBACK].map((s) => store.get(cdKey(s), 0) - Date.now()));
}
const isDown = (src) => store.get("down:" + src.name, 0) > Date.now();
const markDown = (src) => store.set("down:" + src.name, Date.now() + DOWN_MS);
const markUp = (src) => { if (store.get("down:" + src.name, 0)) store.del("down:" + src.name); };
export function activeSource() { return isDown(PRIMARY) && !isDown(FALLBACK) ? FALLBACK.name : PRIMARY.name; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 节流：超出额度时排队等一会儿（最多 maxWaitMs），等不到才报「点得太快」
async function slot(src) {
  for (;;) {
    const now = Date.now();
    const list = (recent.get(src.name) || []).filter((t) => now - t < Math.max(...src.limits.map((l) => l.windowMs)));
    recent.set(src.name, list);
    let wait = 0;
    for (const l of src.limits) {
      const inWin = list.filter((t) => now - t < l.windowMs);
      if (inWin.length >= l.max) wait = Math.max(wait, inWin[inWin.length - l.max] + l.windowMs - now + 20);
    }
    if (!wait) { list.push(now); return; }
    if (wait > (src.maxWaitMs || 4000)) throw new ApiError("throttle", "点得有点快，稍等一下再试");
    await sleep(wait);
  }
}

async function request(src, u) {
  const left = store.get(cdKey(src), 0) - Date.now();
  if (left > 0) throw new ApiError("cooldown", `诗库正在歇口气，${Math.ceil(left / 1000)} 秒后再试`);
  await slot(src);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), src.timeoutMs || 12000);
  let res;
  try {
    res = await fetch(u, { signal: ctrl.signal, headers: { Accept: "application/json" } });
  } catch (e) {
    throw new ApiError("network", e.name === "AbortError" ? "诗库响应太慢了，稍后再试" : "连不上诗库，请检查网络");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    const ra = parseInt(res.headers.get("Retry-After") || "", 10);
    const ms = ra > 0 ? ra * 1000 : (src.cooldownMs || 60000);
    store.set(cdKey(src), Date.now() + ms);
    throw new ApiError("429", `诗库访问太频繁，先歇 ${Math.round(ms / 1000)} 秒`, 429);
  }
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok) {
    const err = body && body.error;
    const msg = typeof err === "string" ? err : (err && err.message) || (body && body.message) || "";
    const code = err && err.code;
    throw new ApiError(res.status >= 500 ? "server" : res.status === 404 ? "notfound" : "http",
      res.status >= 500 ? `诗库暂时不可用（${res.status}）` : (msg ? `诗库返回：${msg}` : `诗库返回 ${res.status}`), res.status, code || msg);
  }
  return body;
}

// 带缓存的 GET。persistMs > 0 时同时写入 localStorage
async function cached(src, u, persistMs = 0) {
  if (persistMs && memCache.has(u)) return memCache.get(u);
  if (persistMs) {
    const hit = store.getFresh("c:" + u, persistMs);
    if (hit) { memCache.set(u, hit); return hit; }
  }
  const body = await request(src, u);
  if (persistMs) {
    memCache.set(u, body);
    store.setFresh("c:" + u, body);
    pruneCache();
  }
  return body;
}

function pruneCache() {
  // 列表缓存最多保留 80 条，避免 localStorage 越积越多
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("yinshi:c:") && /(works|search)\?/.test(k));
    if (keys.length <= 80) return;
    keys.map((k) => [k, (JSON.parse(localStorage.getItem(k)) || {}).at || 0])
      .sort((a, b) => a[1] - b[1]).slice(0, keys.length - 80)
      .forEach(([k]) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

// 主诗库请求：成功就记「在线」；连不上 / 5xx 记「暂时离线」10 分钟
async function primary(path, params, persistMs = 0) {
  try {
    const body = await cached(PRIMARY, url(PRIMARY, path, params), persistMs);
    markUp(PRIMARY);
    return body;
  } catch (e) {
    if (e.kind === "network" || e.kind === "server") markDown(PRIMARY);
    throw e;
  }
}
const canFallback = (e) => ["network", "server", "429", "cooldown", "throttle"].includes(e.kind);

// 游标分页：第 n 页 = 依次取前面各页的 next_cursor（前面的页都已缓存，不会重复请求）
async function paged(path, params, page, persistMs = DAY) {
  let cursor = "", body = null;
  for (let i = 1; i <= page; i++) {
    body = await primary(path, Object.assign({}, params, cursor ? { cursor } : {}), persistMs);
    cursor = body && body.meta && body.meta.next_cursor;
    if (i < page && !cursor) return { data: [], hasMore: false };
  }
  return { data: body && Array.isArray(body.data) ? body.data : [], hasMore: !!cursor };
}

/* ---------- 诗人：名字 → id ---------- */
const authorIds = new Map();
async function authorId(name, dynasty = "") {
  const n = simp(name).trim();
  if (!n) return null;
  const key = n + "|" + dynasty;
  if (authorIds.has(key)) return authorIds.get(key);
  const body = await primary("/authors", { q: n, page_size: 20 }, 30 * DAY);
  const list = (body && Array.isArray(body.data) ? body.data : []).filter((a) => a.name === n);
  const pick = (dynasty && list.find((a) => a.dynasty === simp(dynasty))) || list[0] || null;
  const id = pick ? pick.id : null;
  authorIds.set(key, id);
  return id;
}

/* ---------- 备用诗库（诗泉） ---------- */
async function pmRandom(params) {
  const p = { lang: LANG };
  if (params.char) p.char = forPalemoky(params.char);
  if (params.author) p.author = forPalemoky(params.author);
  if (params.dynasty) p.dynasty = forPalemoky(DYN_TO_PALEMOKY[params.dynasty] || params.dynasty);
  const t = (params.type || []).map((x) => TYPE_TO_PALEMOKY[TYPES[x]]).filter(Boolean);
  if (t.length) p.type = t.map(forPalemoky);
  let b;
  try { b = await request(FALLBACK, url(FALLBACK, "/poems/random", p)); markUp(FALLBACK); }
  catch (e) { if (e.status === 404) return null; if (e.kind === "network" || e.kind === "server") markDown(FALLBACK); throw e; }
  const d = b && b.data && !Array.isArray(b.data) ? b.data : b;
  return d && Array.isArray(d.content) ? normalizePm(d, langTag()) : null;
}
async function pmSearch(q, page) {
  const b = await cached(FALLBACK, url(FALLBACK, "/search", { q: forPalemoky(q), page, lang: LANG }), DAY);
  const pg = (b && b.pagination) || {};
  return { list: (b && Array.isArray(b.data) ? b.data : []).map((p) => normalizePm(p, langTag())), hasMore: !!(pg.hasMore || pg.has_next_page), total: typeof pg.total === "number" ? pg.total : null };
}

/* ---------- 对外接口 ---------- */

/** 随机一首。params: { author, dynasty, type: ["诗","词","曲"], char } */
export async function random(params = {}) {
  if (params.char) {
    // 主诗库不按单字抽诗：从备用诗库抽
    return pmRandom({ char: params.char });
  }
  try {
    const q = {};
    if (params.dynasty) q.dynasty = simp(params.dynasty);
    const ts = (Array.isArray(params.type) ? params.type : params.type ? [params.type] : []).map((t) => TYPES[simp(t)]).filter(Boolean);
    if (ts.length) q.type = ts[Math.floor(Math.random() * ts.length)];
    if (params.author) {
      const [id, fromCp] = await Promise.all([authorId(params.author).catch((e) => { if (canFallback(e)) return undefined; throw e; }), cpRandomPick(params)]);
      if (fromCp && fromCp.pick) return fromCp.poem();
      if (!id) {
        if (fromCp) return fromCp.poem();          // 主诗库没收这位诗人：从全唐诗 / 全宋诗抽
        return pmRandom(params);                   // 也不在全唐诗 / 全宋诗：改从备用诗库抽
      }
      q.author_id = id;
    }
    const b = await primary("/works/random", q);
    return b && b.data && Array.isArray(b.data.content) ? normalize(b.data) : null;
  } catch (e) {
    // 没有符合条件的诗 / 主诗库忙：主诗库目前缺唐诗、宋诗，先从全唐诗 / 全宋诗抽，再到备用诗库找
    if (e.status !== 404 && !canFallback(e)) throw e;
    const c = await cpRandomAny(params).catch(() => null);
    if (c) return c;
    if (e.status === 404) { try { return await pmRandom(params); } catch { return null; } }
    return pmRandom(params);
  }
}

/* ---------- 全唐诗 / 全宋诗（chinese-poetry） ---------- */
const cpDyn = (d) => (!d ? "" : ["唐", "宋"].includes(simp(d)) ? simp(d) : null);   // null：这个朝代不在全唐诗 / 全宋诗里
const cpTypeOk = (type) => { const ts = (Array.isArray(type) ? type : type ? [type] : []).map(simp); return !ts.length || ts.includes("诗"); };

// 随机某位诗人：按两边的作品数决定从哪边抽（主诗库这位诗人的作品数只在列过一次之后才知道，之前按 50 首估）
async function cpRandomPick(params) {
  const dyn = cpDyn(params.dynasty);
  if (dyn === null || !cpTypeOk(params.type)) return null;
  const name = simp(params.author).trim();
  let ids;
  try { ids = await cp.authorIds(name, dyn); } catch { return null; }
  if (!ids.length) return null;
  const st = merged.get(name + "|" + (params.dynasty ? simp(params.dynasty) : ""));
  const stN = st ? (st.stMore ? Math.max(50, st.stCount) : st.stCount) : 50;
  return {
    pick: Math.random() < ids.length / (ids.length + stN),
    poem: async () => {
      for (let tries = 0; tries < 3; tries++) {
        const [p] = await cp.poems([ids[Math.floor(Math.random() * ids.length)]]);
        if (p) return p;
      }
      return null;
    },
  };
}

async function cpRandomAny(params) {
  if (params.author) { const c = await cpRandomPick(params); return c ? c.poem() : null; }
  const dyn = cpDyn(params.dynasty);
  if (!dyn || !cpTypeOk(params.type)) return null;          // 不限朝代时不替主诗库做主
  const ix = await cp.load();
  const S = ix.stride || 1024, n = dyn === "宋" ? ix.files.song : ix.files.tang, base = dyn === "宋" ? ix.songBase : 0;
  for (let tries = 0; tries < 3; tries++) {
    // 随机一块里的随机一首（每块至少 997 首；最后一块不足时抽到空号就再抽）
    const [p] = await cp.poems([base + Math.floor(Math.random() * n) * S + Math.floor(Math.random() * 997)]);
    if (p) return p;
  }
  return null;
}

// 诗名开头检索：先给唐诗三百首、唐诗；最多下载 3 块正文（唐诗三百首的诗自带全文）
async function cpTitleSearch(q, limit = 12) {
  try {
    const ids = await cp.titleIds(simp(q), limit);
    if (!ids.length) return [];
    const take = [], blocks = new Set();
    const featured = new Set((await cp.load()).featured);
    for (const id of ids) {
      if (take.length >= limit) break;
      if (!featured.has(id)) {
        const b = cp.block(id);
        if (!blocks.has(b) && blocks.size >= 3) continue;
        blocks.add(b);
      }
      take.push(id);
    }
    const list = await cp.poems(take);
    // 同名时作品多的诗人（李白、杜甫……）排前面
    const k = cp.normTitle(simp(q));
    const rank = (p) => (cp.normTitle(p.title) === k ? 1e6 : 0) + (featured.has(p.cp) ? 5e5 : 0) + (p.dynasty === "唐" ? 1e5 : 0) + Math.min(cp.fame(p.author), 9e4);
    return list.sort((a, b) => rank(b) - rank(a));
  } catch { return []; }
}

// 去重：同一位诗人、正文开头相同就是同一首（诗名写法常不同，如「蜀道难」「相和歌辞 蜀道难」）
const cpKey = (p) => simp(p.author) + "|" + Array.from(simp((p.lines || []).join(""))).filter((c) => /[\u3400-\u9fff]/.test(c)).slice(0, 12).join("");

/** 搜索诗名、诗人（2 个字起）。单字改为随机抽几首含这个字的诗：返回 sampled: true */
export async function search(q, page = 1) {
  const s = simp(q).trim();
  const len = Array.from(s.replace(/\s+/g, "")).length;
  if (len < 2) {
    if (!len || page > 1) return { list: [], hasMore: false, total: null, sampled: true };
    const out = [], seen = new Set();
    for (let i = 0; i < CHAR_SAMPLES; i++) {
      try {
        const p = await pmRandom({ char: s });
        if (p && !seen.has(p.title + p.author)) { seen.add(p.title + p.author); out.push(p); }
      } catch { break; }       // 备用诗库也忙：只给课本里的结果和飞花令入口
    }
    return { list: out, hasMore: false, total: null, sampled: true };
  }
  const cpHits = page === 1 ? cpTitleSearch(s) : Promise.resolve([]);
  const withCp = async (r) => {
    const hits = await cpHits;
    if (!hits.length) return r;
    const seen = new Set(hits.map(cpKey)), seen2 = new Set(hits.map((p) => cp.normTitle(simp(p.title)) + "|" + simp(p.author)));
    // 主诗库 / 备用里同一首（同名同作者）不再重复
    return { ...r, list: hits.concat(r.list.filter((p) => !seen.has(cpKey(p)) && !seen2.has(cp.normTitle(simp(p.title)) + "|" + simp(p.author)))) };
  };
  // 3 个字以上的第一页同时问备用诗库：主诗库目前缺唐诗、宋诗（如《将进酒》《望庐山瀑布》），备用诗库有
  const extra = page === 1 && len >= FALLBACK.minSearch ? pmSearch(q, 1).catch(() => null) : Promise.resolve(null);
  try {
    const [r, pm] = await Promise.all([paged("/works", { q: s, page_size: PAGE_SIZE }, page), extra]);
    let list = r.data.map(normalize);
    if (pm && pm.list.length) {
      const key = (p) => simp(p.title) + "|" + simp(p.author);
      const seen = new Set(list.map(key));
      const more = pm.list.filter((p) => !seen.has(key(p)));
      const hit = more.filter((p) => simp(p.title).includes(s));
      list = hit.concat(list, more.filter((p) => !hit.includes(p)));
    }
    return withCp({ list, hasMore: r.hasMore, total: null });
  } catch (e) {
    if (!canFallback(e) || len < FALLBACK.minSearch) {
      const hits = await cpHits;
      if (hits.length && canFallback(e)) return { list: hits, hasMore: false, total: null };
      throw e;
    }
    const pm = await extra;                      // 第一页已经问过备用诗库
    return withCp(pm || await pmSearch(q, page));
  }
}

/** 某位诗人的诗：主诗库（按 id 游标分页）+ 全唐诗 / 全宋诗（唐诗三百首在前，其余按卷序），去重后一页一页给。
 *  dynasty 用来区分同名诗人。第 n 页总是同样的内容（已经算过的页缓存着）。 */
const merged = new Map();
const CP_PAGE = 50;
export async function authorPoems(name, page = 1, _same = null, dynasty = "") {
  const n = simp(name).trim();
  const key = n + "|" + (dynasty ? simp(dynasty) : "");
  let st = merged.get(key);
  if (!st) {
    st = { pages: [], keys: new Set(), stPage: 0, stMore: true, stCount: 0, stId: undefined, cpIds: null, cpPos: 0, dups: 0 };
    merged.set(key, st);
  }
  while (st.pages.length < page) {
    if (st.pages.length && !morePages(st)) break;
    await nextAuthorPage(st, n, dynasty);
  }
  const list = st.pages[page - 1] || [];
  const total = st.stMore || !st.cpIds ? null : st.stCount + st.cpIds.length - st.dups;
  return { list, hasMore: page < st.pages.length || morePages(st), total };
}
const morePages = (st) => st.stMore || (st.cpIds ? st.cpPos < st.cpIds.length : false);

async function nextAuthorPage(st, n, dynasty) {
  const dyn = cpDyn(dynasty);
  const firstTime = st.cpIds === null;
  const stTask = st.stMore ? (async () => {
    if (st.stId === undefined) st.stId = await authorId(n, dynasty);
    if (!st.stId) return { data: [], hasMore: false };
    return paged(`/authors/${encodeURIComponent(st.stId)}/works`, { page_size: AUTHOR_PAGE_SIZE }, st.stPage + 1);
  })() : Promise.resolve(null);
  const cpTask = (async () => {
    if (st.cpIds === null) st.cpIds = dyn === null ? [] : await cp.authorIds(n, dyn);
    const ids = st.cpIds.slice(st.cpPos, st.cpPos + CP_PAGE);
    return ids.length ? { ids, list: await cp.poems(ids) } : { ids, list: [] };
  })();
  const [sr, cr] = await Promise.allSettled([stTask, cpTask]);
  const out = [];
  const add = (p) => { const k = cpKey(p); if (st.keys.has(k)) { st.dups++; return; } st.keys.add(k); out.push(p); };
  if (cr.status === "fulfilled") { cr.value.list.forEach(add); st.cpPos += cr.value.ids.length; }
  else if (firstTime) st.cpIds = st.cpIds || [];
  if (sr.status === "fulfilled" && sr.value) {
    const data = sr.value.data.map(normalize);
    st.stPage += 1; st.stCount += data.length; st.stMore = sr.value.hasMore;
    data.forEach(add);
  } else if (sr.status === "rejected") {
    // 主诗库忙 / 连不上：只要全唐诗 / 全宋诗有，就先用这边的（主诗库这一页以后不再补）
    if (!out.length && !(st.cpIds && st.cpPos < st.cpIds.length)) throw sr.reason;
    st.stMore = false;
  }
  if (cr.status === "rejected" && sr.status === "rejected") throw sr.reason;
  if (cr.status === "rejected" && !out.length && !st.stMore) throw new ApiError("network", "唐诗宋诗数据暂时取不到，稍后再试");
  st.pages.push(out);
}

/** 诗人生卒年（主诗库 /authors，与按诗人搜索共用 30 天缓存）；查不到返回 null，不抛错 */
export async function authorInfo(name, dynasty = "") {
  const n = simp(name).trim();
  if (!n || cooldownLeft() > 0) return null;
  try {
    const body = await primary("/authors", { q: n, page_size: 20 }, 30 * DAY);
    const list = (body && Array.isArray(body.data) ? body.data : []).filter((a) => a.name === n);
    const a = (dynasty && list.find((x) => x.dynasty === simp(dynasty))) || list[0];
    return a ? { name: a.name, dynasty: a.dynasty || "", birth: a.birthYear || "", death: a.deathYear || "" } : null;
  } catch { return null; }
}

/** 唐诗三百首全文（本站托管，不请求接口） */
export const featuredPoems = () => cp.featuredPoems();

/** 朝代 / 体裁 */
export async function meta(kind) {
  if (kind === "types") return Object.keys(TYPES);
  const b = await primary("/dynasties", {}, 7 * DAY);
  const list = (b && Array.isArray(b.data) ? b.data : []).filter(Boolean);
  const rank = (d) => { const i = DYN_ORDER.indexOf(d); return i < 0 ? 99 : i; };
  return list.sort((a, b2) => rank(a) - rank(b2));
}

export function normalize(p) {
  return {
    id: p.id,
    title: String(p.title || "").replace(/\s+/g, " ").trim(),
    author: p.authorName || "",
    authorId: p.authorId || "",
    dynasty: p.dynasty || "",
    type: TYPE_NAME[p.type] || "",
    lines: (p.content || []).map((l) => String(l).trim()).filter(Boolean),
    source: "api",
    lang: "hans",
  };
}
function normalizePm(p, lang) {
  return {
    id: "pm" + p.id,
    title: String(p.title || "").replace(/\s+/g, " ").trim(),
    author: (p.author && p.author.name) || "",
    dynasty: (p.dynasty && p.dynasty.name) || "",
    type: (p.type && p.type.name) || "",
    lines: (p.content || []).map((l) => String(l).trim()).filter(Boolean),
    source: "api",
    lang,
  };
}
