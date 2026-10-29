// 诗泉 API 客户端
// · 按 config.js 的顺序用实例：主实例连不上（网络错误 / 超时 / 5xx）就自动改用备用实例，并记 10 分钟；
// · 页面加载不发请求，只在用户操作时调用；
// · 搜索 / 朝代 / 体裁结果缓存在内存 + localStorage；
// · 每个实例单独节流（主实例每秒最多 4 次），遇到 429 冷却一会儿。
import * as store from "./store.js";

const DEFAULT_SOURCES = [
  { name: "llmaix", base: "https://poetry.llmaix.com/api/v1",
    paths: { random: "/poems/random", search: "/poems/search", types: "/types", dynasties: "/dynasties" },
    searchTypes: true, minSearch: 1, randomWrapped: false, rate: { windowMs: 1000, max: 4 }, cooldownMs: 15000, timeoutMs: 8000 },
  { name: "palemoky", base: "https://poetry.palemoky.com/api",
    paths: { random: "/poems/random", search: "/search", types: "/types", dynasties: "/dynasties" },
    searchTypes: false, minSearch: 3, randomWrapped: true, rate: { windowMs: 20000, max: 5 }, cooldownMs: 90000, timeoutMs: 12000 },
];
const RAW = window.YINSHI_CONFIG || {};
// 兼容旧版配置（单个 API_BASE + API_PREFIX）
const SOURCES = Array.isArray(RAW.SOURCES) && RAW.SOURCES.length ? RAW.SOURCES
  : RAW.API_BASE ? [{ name: "custom", base: RAW.API_BASE.replace(/\/$/, "") + (RAW.API_PREFIX || ""),
      paths: Object.assign({}, DEFAULT_SOURCES[0].paths, RAW.PATHS || {}), searchTypes: /\/v1$/.test(RAW.API_PREFIX || ""),
      minSearch: /\/v1$/.test(RAW.API_PREFIX || "") ? 1 : 3, randomWrapped: !/\/v1$/.test(RAW.API_PREFIX || ""),
      rate: { windowMs: 20000, max: 5 }, cooldownMs: 90000, timeoutMs: RAW.TIMEOUT_MS || 12000 }]
  : DEFAULT_SOURCES;
const PAGE_SIZE = RAW.PAGE_SIZE || 30;
const AUTHOR_PAGE_SIZE = RAW.AUTHOR_PAGE_SIZE || 50;
const DOWN_MS = 10 * 60e3;
const DAY = 864e5;

let LANG = "zh-Hans";
export function setLang(l) { LANG = l === "zh-Hant" ? "zh-Hant" : "zh-Hans"; }
export function getLang() { return LANG; }
const langTag = () => (LANG === "zh-Hant" ? "hant" : "hans");

const memCache = new Map();
const recent = new Map();     // 实例名 → 最近请求时间戳

export class ApiError extends Error {
  constructor(kind, message, status = 0, raw = "") { super(message); this.kind = kind; this.status = status; this.raw = raw; }
}

function buildUrl(src, key, params = {}, lang = LANG) {
  const path = (src.paths && src.paths[key]) || "/" + key;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    (Array.isArray(v) ? v : [v]).forEach((one) => one !== "" && one != null && qs.append(k, one));
  }
  if (lang) qs.append("lang", lang);
  return src.base.replace(/\/$/, "") + path + "?" + qs.toString();
}

function cdKey(src) { return "cooldown:" + src.name; }
export function cooldownLeft() {
  return Math.max(0, ...SOURCES.map((s) => store.get(cdKey(s), 0) - Date.now()));
}
function isDown(src) { return store.get("down:" + src.name, 0) > Date.now(); }
function markDown(src) { store.set("down:" + src.name, Date.now() + DOWN_MS); }
function markUp(src) { if (store.get("down:" + src.name, 0)) store.del("down:" + src.name); }
// 能用的实例排前面；全都标了「连不上」时仍按原顺序都试一遍
function ordered() { return [...SOURCES.filter((s) => !isDown(s)), ...SOURCES.filter(isDown)]; }
export function activeSource() { return ordered()[0].name; }

async function request(src, u) {
  const left = store.get(cdKey(src), 0) - Date.now();
  if (left > 0) throw new ApiError("cooldown", `诗库正在歇口气，${Math.ceil(left / 1000)} 秒后再试`);
  const now = Date.now();
  const rate = src.rate || { windowMs: 1000, max: 4 };
  const list = recent.get(src.name) || [];
  while (list.length && now - list[0] > rate.windowMs) list.shift();
  if (list.length >= rate.max) throw new ApiError("throttle", "点得有点快，稍等一下再试");
  list.push(now); recent.set(src.name, list);

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
    const ms = src.cooldownMs || 30000;
    store.set(cdKey(src), Date.now() + ms);
    throw new ApiError("429", `诗库访问太频繁，先歇 ${Math.round(ms / 1000)} 秒`, 429);
  }
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok) {
    const err = body && body.error;
    const msg = typeof err === "string" ? err : (err && err.message) || (body && body.message) || "";
    throw new ApiError(res.status >= 500 ? "server" : "http", res.status >= 500 ? `诗库暂时不可用（${res.status}）` : (msg ? `诗库返回：${msg}` : `诗库返回 ${res.status}`), res.status, msg);
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
  // 搜索缓存最多保留 60 条，避免 localStorage 越积越多
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("yinshi:c:") && /search\?/.test(k));
    if (keys.length <= 60) return;
    keys.map((k) => [k, (JSON.parse(localStorage.getItem(k)) || {}).at || 0])
      .sort((a, b) => a[1] - b[1]).slice(0, keys.length - 60)
      .forEach(([k]) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

const failover = (e) => e.kind === "network" || e.kind === "server";

// 依次尝试各实例。build(src) 返回 {key, params, lang?} 或 {skip: 原因}
async function call(build, persistMs = 0) {
  const list = ordered();
  let lastErr = null, skipped = "";
  for (let i = 0; i < list.length; i++) {
    const src = list[i];
    const req = build(src);
    if (!req || req.skip) { skipped = skipped || (req && req.skip) || "skip"; continue; }
    try {
      const body = await cached(src, buildUrl(src, req.key, req.params, req.lang === undefined ? LANG : req.lang), persistMs);
      markUp(src);
      return { body, src };
    } catch (e) {
      if (!failover(e)) throw e;
      lastErr = e; markDown(src);       // 连不上 / 5xx：换下一个实例
    }
  }
  // 能用的实例都不支持这项查询（例如备用实例不支持一两个字的搜索）时，说清楚原因，而不是只说连不上
  if (skipped === "short") throw new ApiError("short", lastErr ? "主诗库暂时连不上，备用诗库不支持一两个字的全文搜索" : "当前诗库不支持一两个字的全文搜索");
  if (skipped) throw new ApiError("unsupported", "当前诗库不支持这项查询");
  throw lastErr || new ApiError("network", "连不上诗库，请检查网络");
}

// 分页：新版给 page/total_pages；旧版给 hasMore 或 has_next_page
function hasMoreOf(body, page) {
  const pg = body && body.pagination;
  if (!pg) return false;
  if ("hasMore" in pg) return !!pg.hasMore;
  if ("has_next_page" in pg) return !!pg.has_next_page;
  if (pg.total_pages != null) return page < pg.total_pages;
  return false;
}
const totalOf = (body) => (body && body.pagination && typeof body.pagination.total === "number" ? body.pagination.total : null);

export async function random(params = {}) {
  const tag = langTag();
  let r;
  try { r = await call(() => ({ key: "random", params })); }   // 随机不缓存
  catch (e) { if (e.status === 404) return null; throw e; }      // 没有这位作者 / 没有符合条件的诗
  const b = r.body;
  const p = b && b.data && !Array.isArray(b.data) ? b.data : b;
  return p && Array.isArray(p.content) ? normalize(p, tag) : null;
}

/** 搜索：type = all | title | content（旧实例只支持 all） */
export async function search(q, page = 1, type = "all") {
  const len = Array.from(q.trim()).length, tag = langTag();
  const { body } = await call((src) => {
    if (len < (src.minSearch || 1)) return { skip: "short" };
    const params = { q, page };
    if (src.searchTypes) { params.page_size = PAGE_SIZE; if (type && type !== "all") params.type = type; }
    return { key: "search", params };
  }, DAY);
  const list = (body && Array.isArray(body.data) ? body.data : []).map((p) => normalize(p, tag));
  return { list, hasMore: hasMoreOf(body, page), total: totalOf(body) };
}

/**
 * 某位诗人的诗：用 search?type=author（包含匹配），再按作者名精确核对。
 * same(a, b) 用来比较作者名。旧实例不支持，返回 unsupported。
 * 诗人的诗目固定取简体库：繁体库收录不全（2026-10 实测「陸游」只有 146 首，简体库 9000 多首），繁体由页面本地转换。
 */
export async function authorPoems(name, page = 1, same = (a, b) => a === b) {
  const tag = "hans";
  let r;
  try {
    r = await call((src) => (src.searchTypes ? { key: "search", params: { q: name, type: "author", page, page_size: AUTHOR_PAGE_SIZE }, lang: "zh-Hans" } : { skip: "author" }), DAY);
  } catch (e) {
    if (e.kind === "unsupported") return { list: [], hasMore: false, unsupported: true };
    throw e;
  }
  const all = (r.body && Array.isArray(r.body.data) ? r.body.data : []).map((p) => normalize(p, tag));
  const list = all.filter((p) => same(p.author, name));
  return { list, hasMore: hasMoreOf(r.body, page), total: list.length === all.length ? totalOf(r.body) : null };
}

// 朝代 / 体裁：固定取简体（筛选条件按简体保存，请求时再转换）
export async function meta(kind) {
  const { body } = await call(() => ({ key: kind, params: {}, lang: "zh-Hans" }), 7 * DAY);
  return (body && Array.isArray(body.data) ? body.data : []).map((x) => x.name).filter(Boolean);
}

export function normalize(p, lang = langTag()) {
  return {
    id: p.id,
    title: String(p.title || "").replace(/\s+/g, " ").trim(),
    author: (p.author && p.author.name) || "",
    dynasty: (p.dynasty && p.dynasty.name) || "",
    type: (p.type && p.type.name) || "",
    lines: (p.content || []).map((l) => String(l).trim()).filter(Boolean),
    source: "api",
    lang,
  };
}
