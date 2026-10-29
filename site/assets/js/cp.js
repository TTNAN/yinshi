// 全唐诗 / 全宋诗：chinese-poetry 数据集（MIT，https://github.com/chinese-poetry/chinese-poetry）
// · 本站只托管由 tools/build-cp-index.mjs 生成的小索引（site/data/cp/）：诗人 → 作品编号、诗名索引、唐诗三百首全文；
// · 诗的正文由浏览器直接从公共 CDN 按「1000 首一块」取回（unpkg 上的 npm 包 chinese-poetry@2.0.1，
//   取不到时改用 raw.githubusercontent.com 上同一份数据的固定提交），不经任何中转；
// · 数据是繁体：用索引里的繁→简单字表转成简体（与页面其它诗一样按简体注音，繁體模式再由 OpenCC 转回）。
const VQ = (() => { const v = new URL(import.meta.url).searchParams.get("v"); return v ? "?v=" + v : ""; })();
const DATA = new URL("../../data/cp/", import.meta.url);
const CHUNK_TIMEOUT = 15000;
const MAX_CHUNKS = 16;

let idx = null, idxP = null, feat = null, featP = null, T2S = null;
const byName = new Map();        // 简体名 → [{ dyn, count, ids }]
const chunks = new Map();        // "tang:12" → Promise<array>
const shards = new Map();

const HAN = /[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2ffff}]/u;
const han = (s) => Array.from(String(s || "")).filter((c) => HAN.test(c)).join("");
export const normTitle = (t) => String(t || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");

async function getJSON(u, ms = CHUNK_TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(u, { signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return u.includes(".txt") ? await r.text() : await r.json();
  } finally { clearTimeout(timer); }
}

function decodeRuns(s) {
  const ids = [];
  let last = 0;
  for (const part of String(s).split(",")) {
    if (!part) continue;
    const [d, l] = part.split("+");
    const st = last + parseInt(d, 36), len = l ? parseInt(l, 36) : 1;
    for (let i = 0; i < len; i++) ids.push(st + i);
    last = st + len;
  }
  return ids;
}

/** 载入索引（约 140 KB gzip），只在第一次需要时 */
export function load() {
  if (idx) return Promise.resolve(idx);
  if (!idxP) {
    idxP = getJSON(new URL("index.json" + VQ, DATA).href, 20000).then((j) => {
      T2S = new Map();
      const a = Array.from(j.t2s);
      for (let i = 0; i + 1 < a.length; i += 2) T2S.set(a[i], a[i + 1]);
      for (const [name, dyn, count, runs] of j.authors) {
        const list = byName.get(name) || [];
        list.push({ dyn: dyn ? "宋" : "唐", count, runs });
        byName.set(name, list);
      }
      idx = j;
      return j;
    }).catch((e) => { idxP = null; throw e; });
  }
  return idxP;
}
export const ready = () => !!idx;

function featured() {
  if (feat) return Promise.resolve(feat);
  if (!featP) {
    featP = getJSON(new URL("featured.json" + VQ, DATA).href, 20000).then((arr) => {
      feat = new Map(arr.map((x) => [x.id, x]));
      return feat;
    }).catch((e) => { featP = null; throw e; });
  }
  return featP;
}

export const t2s = (s) => Array.from(String(s || "")).map((c) => (T2S && T2S.get(c)) || c).join("");

// 编号 → 第几块（文件）的第几首。每块占 stride（1024）个编号
function where(id) {
  const S = idx.stride || 1024;
  return id >= idx.songBase
    ? { kind: "song", file: Math.floor((id - idx.songBase) / S), i: (id - idx.songBase) % S }
    : { kind: "tang", file: Math.floor(id / S), i: id % S };
}
export const block = (id) => { const w = where(id); return w.kind + w.file; };

async function chunk(kind, file) {
  const key = kind + ":" + file;
  if (chunks.has(key)) {
    const p = chunks.get(key);
    chunks.delete(key); chunks.set(key, p);            // 最近用过的放到最后
    return p;
  }
  const name = `poet.${kind}.${file * 1000}.json`;
  const p = (async () => {
    let err;
    for (const base of idx.cdn) {
      try { return await getJSON(base + name); } catch (e) { err = e; }
    }
    throw err || new Error("CDN");
  })();
  chunks.set(key, p);
  p.catch(() => chunks.delete(key));
  while (chunks.size > MAX_CHUNKS) chunks.delete(chunks.keys().next().value);
  return p;
}

function toPoem(raw, id, dyn) {
  return {
    id: "cp" + id,
    cp: id,
    title: t2s(String(raw.title || "").replace(/\s+/g, " ").trim()),
    author: t2s(raw.author || ""),
    dynasty: dyn,
    type: "诗",
    lines: (raw.paragraphs || []).map((l) => t2s(String(l).trim())).filter(Boolean),
    source: "api",
    lang: "hans",
  };
}
function fromFeatured(f) {
  return { id: "cp" + f.id, cp: f.id, title: f.t, author: f.a, dynasty: f.d, type: "诗", lines: f.l.slice(), source: "api", lang: "hans" };
}

/** 唐诗三百首（简体全文，诗词接龙用） */
export async function featuredPoems() { await load(); const f = await featured(); return [...f.values()].map(fromFeatured); }

/** 按编号取诗（featured 内的不用下载大块） */
export async function poems(ids) {
  await load();
  const f = idx.featured.some((x) => ids.includes(x)) ? await featured().catch(() => null) : null;
  const out = new Map();
  const need = new Map();
  for (const id of ids) {
    if (f && f.has(id)) { out.set(id, fromFeatured(f.get(id))); continue; }
    const w = where(id);
    const k = w.kind + ":" + w.file;
    if (!need.has(k)) need.set(k, { ...w, ids: [] });
    need.get(k).ids.push(id);
  }
  await Promise.all([...need.values()].map(async (n) => {
    const arr = await chunk(n.kind, n.file);
    for (const id of n.ids) {
      const raw = arr[where(id).i];
      if (raw) out.set(id, toPoem(raw, id, n.kind === "song" ? "宋" : "唐"));
    }
  }));
  return ids.map((id) => out.get(id)).filter((p) => p && p.lines.length);
}

/** 某位诗人：全部作品编号（唐诗三百首里的排在最前），可按朝代过滤 */
export async function authorIds(name, dynasty = "") {
  await load();
  const list = (byName.get(name) || []).filter((a) => !dynasty || a.dyn === dynasty);
  if (!list.length) return [];
  const all = [];
  for (const a of list) {
    if (!a.ids) a.ids = decodeRuns(a.runs);
    all.push(...a.ids);
  }
  const fs = new Set(idx.featured);
  return all.filter((id) => fs.has(id)).concat(all.filter((id) => !fs.has(id)));
}
export async function authorCount(name, dynasty = "") {
  await load();
  return (byName.get(name) || []).filter((a) => !dynasty || a.dyn === dynasty).reduce((s, a) => s + a.count, 0);
}
const fame = (name) => (byName.get(name) || []).reduce((s, a) => s + a.count, 0);

/** 诗名开头检索（≥2 个字）。返回排好序的编号：完全同名 > 唐诗三百首 > 唐 > 名家 */
export async function titleIds(q, limit = 12) {
  await load();
  const k = normTitle(q);
  const two = Array.from(han(k)).slice(0, 2).join("");
  if (Array.from(two).length < 2) return [];
  let h = 0;
  for (const c of two) h = (h * 31 + c.codePointAt(0)) >>> 0;
  const n = h % idx.shards;
  let p = shards.get(n);
  if (!p) {
    p = getJSON(new URL(`t/${String(n).padStart(2, "0")}.txt` + VQ, DATA).href, 20000)
      .then((txt) => txt.split("\n").map((l) => { const i = l.indexOf("\t"); return [parseInt(l.slice(0, i), 36), l.slice(i + 1)]; }));
    shards.set(n, p);
    p.catch(() => shards.delete(n));
  }
  const rows = await p;
  const fs = new Set(idx.featured);
  const hits = rows.filter(([, t]) => t.startsWith(k));
  const score = ([id, t]) => (t === k ? 4 : 0) + (fs.has(id) ? 2 : 0) + (id < idx.songBase ? 1 : 0);
  // 同分时：编号小（唐诗按卷序，名家在前的多）——再在调用方按诗人作品数排
  hits.sort((a, b) => score(b) - score(a) || a[0] - b[0]);
  return hits.slice(0, Math.max(limit * 3, 40)).map((x) => x[0]);
}
export { fame };
