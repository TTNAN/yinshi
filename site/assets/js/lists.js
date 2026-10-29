// 学习列表：可以有很多个有名字的诗单（如「今日作业 10-29」），用来定向练习。
// · 只存在这台设备的浏览器里（localStorage「yinshi:lists」），不需要账号；
// · 旧版「我的诗单」里的收藏第一次打开时迁移成默认列表「我的诗单」（收藏数据原样保留，之后两边同步）；
// · 分享：把每首诗的编号写进链接的 #list=…&name=…（课本诗 d序号、全唐诗/全宋诗 c编号、其余 t诗名~作者~首句），打开链接确认后导入。
import * as store from "./store.js";

const KEY = "lists";
export const MINE = "mine";
const HAN = /[\u3400-\u9fff]/;
const hanOnly = (s) => Array.from(String(s || "")).filter((c) => HAN.test(c)).join("");
const baseTitle = (t) => String(t || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
export const keyOf = (p) => baseTitle(p.title) + "|" + p.author;

/** 诗 → 引用编号（分享链接、重新取诗用） */
export function refOf(p) {
  if (p.source === "daily" && p.dailyIndex != null) return "d" + p.dailyIndex;
  if (p.cp != null) return "c" + p.cp;
  return "t" + [baseTitle(p.title), p.author, hanOnly((p.lines || []).join("")).slice(0, 6)].map((x) => String(x || "").replace(/[~,]/g, "")).join("~");
}
export function parseRef(r) {
  r = String(r || "");
  if (/^d\d+$/.test(r)) return { d: +r.slice(1) };
  if (/^c\d+$/.test(r)) return { c: +r.slice(1) };
  if (r[0] === "t") { const [t, a, f] = r.slice(1).split("~"); if (t) return { t, a: a || "", f: f || "" }; }
  return null;
}
// 列表里存一份诗文，离线也能列出、打开
const slim = (p) => ({ title: p.title, author: p.author, dynasty: p.dynasty || "", type: p.type || "", lines: (p.lines || []).slice(), source: p.source || "api", lang: "hans",
  ...(p.dailyIndex != null ? { dailyIndex: p.dailyIndex } : {}), ...(p.cp != null ? { cp: p.cp, id: p.id } : {}) });

let cache = null;
function load() {
  if (cache) return cache;
  const s = store.get(KEY, null);
  if (s && Array.isArray(s.lists)) { cache = s; return cache; }
  // 第一次：把旧版收藏迁移为默认列表「我的诗单」
  const fav = Object.entries(store.get("fav", {})).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  cache = { v: 1, lists: [{ id: MINE, name: "我的诗单", at: Date.now(), items: fav.filter(([, f]) => f && f.p).map(([k, f]) => ({ k, r: refOf(f.p), p: slim(f.p), at: f.at || Date.now() })), log: {} }] };
  save();
  return cache;
}
function save() { store.set(KEY, cache); }
export function reload() { cache = null; return load(); }

export const all = () => load().lists;
export const get = (id) => load().lists.find((l) => l.id === id) || null;
const newId = () => "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

export function create(name) {
  const l = { id: newId(), name: String(name || "").trim().slice(0, 24) || "新列表", at: Date.now(), items: [], log: {} };
  load().lists.push(l); save();
  return l;
}
export function rename(id, name) { const l = get(id); if (!l) return; l.name = String(name || "").trim().slice(0, 24) || l.name; save(); }
export function remove(id) {
  if (id === MINE) return false;          // 默认列表与收藏同步，不能删（可以改名）
  const L = load(); L.lists = L.lists.filter((l) => l.id !== id); save(); return true;
}
export function move(id, d) {
  const L = load().lists, i = L.findIndex((l) => l.id === id), j = i + d;
  if (i < 0 || j < 0 || j >= L.length) return;
  [L[i], L[j]] = [L[j], L[i]]; save();
}
export const has = (id, k) => !!(get(id) && get(id).items.some((x) => x.k === k));
/** 加入：已在列表里返回 false */
export function add(id, p) {
  const l = get(id); if (!l) return false;
  const k = keyOf(p);
  if (l.items.some((x) => x.k === k)) return false;
  l.items.push({ k, r: refOf(p), p: slim(p), at: Date.now() }); save();
  if (id === MINE) syncFav(k, p, true);
  return true;
}
export function drop(id, k) {
  const l = get(id); if (!l) return;
  l.items = l.items.filter((x) => x.k !== k); save();
  if (id === MINE) syncFav(k, null, false);
}
export function moveItem(id, k, d) {
  const l = get(id); if (!l) return;
  const i = l.items.findIndex((x) => x.k === k), j = i + d;
  if (i < 0 || j < 0 || j >= l.items.length) return;
  [l.items[i], l.items[j]] = [l.items[j], l.items[i]]; save();
}
// 默认列表 ↔ 收藏
function syncFav(k, p, on) {
  const f = store.get("fav", {});
  if (on && !f[k]) f[k] = { p: slim(p), at: Date.now() };
  if (!on) delete f[k];
  store.set("fav", f);
}
/** 收藏按钮改了收藏后调用：默认列表跟着加 / 减 */
export function favChanged(k, p, on) {
  const l = get(MINE); if (!l) return;
  const inList = l.items.some((x) => x.k === k);
  if (on && !inList) l.items.push({ k, r: refOf(p), p: slim(p), at: Date.now() });
  if (!on && inList) l.items = l.items.filter((x) => x.k !== k);
  save();
}
export function logPractice(id, ymd, rec) { const l = get(id); if (!l) return; l.log = l.log || {}; l.log[ymd] = rec; save(); }

/** 「今日作业 MM-DD」 */
export const homeworkName = (ymd) => `今日作业 ${ymd.slice(5)}`;

/* ---------------- 分享链接 ---------------- */
export function shareHash(l) {
  const refs = l.items.map((x) => x.r || refOf(x.p));
  return `#list=${encodeURIComponent(refs.join(","))}&name=${encodeURIComponent(l.name)}`;
}
/** 读链接里的列表：{ name, refs } 或 null */
export function parseHash(hash) {
  const h = String(hash || "").replace(/^#/, "");
  if (!/(^|&)list=/.test(h)) return null;
  const q = new URLSearchParams(h);
  const refs = String(q.get("list") || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 60);
  if (!refs.length) return null;
  return { name: String(q.get("name") || "分享的诗单").slice(0, 24), refs };
}
/** 导入为新列表（同名时加上序号） */
export function importList(name, poems) {
  const names = new Set(all().map((l) => l.name));
  let n = name, i = 2;
  while (names.has(n)) n = `${name}（${i++}）`;
  const l = create(n);
  poems.forEach((p) => { const k = keyOf(p); if (!l.items.some((x) => x.k === k)) l.items.push({ k, r: refOf(p), p: slim(p), at: Date.now() }); });
  save();
  return l;
}

/* ---------------- 粘贴诗名 ---------------- */
/** 一段文字 → [{ t 诗名, a 作者 }]：每行 / 顿号 / 逗号 / 书名号分开；「静夜思 李白」「李白《静夜思》」「静夜思-李白」都认 */
export function parseTitles(text) {
  const out = [];
  const s = String(text || "").replace(/\r/g, "");
  const parts = s.match(/[^《》\n、,，;；|]+《[^》]+》|《[^》]+》[^《\n、,，;；|]*|[^\n、,，;；|《》]+/g) || [];
  for (let raw of parts) {
    raw = raw.replace(/^\s*\d+[.、．)]\s*/, "").trim();
    if (!raw) continue;
    let t = raw, a = "";
    let m = raw.match(/^(.*?)《(.+?)》(.*)$/);
    if (m) { t = m[2]; a = (m[1] || m[3] || "").replace(/[\s·\-—:：（）()唐宋元明清代]/g, ""); }
    else if ((m = raw.match(/^(.+?)[\s·\-—/]+([\u3400-\u9fff]{2,4})$/))) { t = m[1]; a = m[2]; }
    t = t.replace(/[\s“”"']/g, "");
    if (hanOnly(t)) out.push({ t, a, raw: raw.replace(/[\s“”"'《》]/g, "") });
  }
  return out.slice(0, 40);
}
