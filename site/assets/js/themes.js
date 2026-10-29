// 纸面主题：宣纸（默认）/ 素笺 / 竹简 / 绢本 / 青花 / 夜读 / 信笺 / 自定义背景。
// 颜色与纹理都在 yinshi.css 的 :root[data-theme=…] 里；这里只负责切换、记住选择，以及「自定义背景」：
// 用户选的图片在本机缩到最长边 ≤ 1600px 的 JPEG，存进浏览器的 IndexedDB，从不上传到任何地方。
import * as store from "./store.js";

export const THEMES = {
  xuan: { name: "宣纸", meta: "#f3ede1" },
  su: { name: "素笺", meta: "#f4f4f1" },
  zhu: { name: "竹简", meta: "#e6ecdc" },
  juan: { name: "绢本", meta: "#e9dcbc" },
  qinghua: { name: "青花", meta: "#eef2f7" },
  ye: { name: "夜读", meta: "#171511" },
  xin: { name: "信笺", meta: "#f2ece0" },
  custom: { name: "自定义", meta: "#f3ede1" },
};
export const DEFAULT = "xuan";
const MAX = 1600;

export function current() { const k = store.get("theme", DEFAULT); return THEMES[k] ? k : DEFAULT; }
export function veil() { const v = Number(store.get("bgVeil", 0.55)); return Number.isFinite(v) ? Math.min(0.9, Math.max(0.1, v)) : 0.55; }

/* ---------- IndexedDB：一张图 ---------- */
function db() {
  return new Promise((res, rej) => {
    if (!("indexedDB" in window)) { rej(new Error("no idb")); return; }
    const r = indexedDB.open("yinshi", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction("kv", mode);
    const req = fn(tx.objectStore("kv"));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}
const getBlob = () => idb("readonly", (s) => s.get("bg")).catch(() => null);
const putBlob = (b) => idb("readwrite", (s) => s.put(b, "bg"));
const delBlob = () => idb("readwrite", (s) => s.delete("bg")).catch(() => null);

let bgUrl = null, bgImg = null;
async function loadBg() {
  if (bgUrl) return bgUrl;
  const b = await getBlob();
  if (!b) return null;
  bgUrl = URL.createObjectURL(b);
  bgImg = null;
  return bgUrl;
}
export const hasCustom = async () => !!(bgUrl || (await getBlob()));

function setBgVars(url) {
  const r = document.documentElement.style;
  if (url) { r.setProperty("--user-bg", `url("${url}")`); r.setProperty("--user-thumb", `url("${url}")`); }
  else { r.removeProperty("--user-bg"); r.removeProperty("--user-thumb"); }
}

export async function apply(k = current()) {
  if (!THEMES[k]) k = DEFAULT;
  const root = document.documentElement;
  if (k === DEFAULT) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", k);
  root.style.setProperty("--veil-a", String(veil()));
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = THEMES[k].meta;
  if (k === "custom" || bgUrl) setBgVars(await loadBg().catch(() => null));
}

export async function choose(k) {
  if (!THEMES[k]) return false;
  if (k === "custom" && !(await hasCustom())) return false;   // 还没选图片：交给调用方打开文件选择
  store.set("theme", k);
  await apply(k);
  return true;
}

export function setVeil(v) {
  store.set("bgVeil", v);
  document.documentElement.style.setProperty("--veil-a", String(veil()));
}

/** 用户选了一张图：缩小、转 JPEG、存本机，然后切到自定义主题 */
export async function setCustom(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("请选择一张图片");
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("这张图片打不开")); i.src = src; });
    const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
    if (!blob) throw new Error("图片处理失败");
    await putBlob(blob);
    if (bgUrl) URL.revokeObjectURL(bgUrl);
    bgUrl = URL.createObjectURL(blob); bgImg = null;
    store.set("theme", "custom");
    await apply("custom");
    return blob.size;
  } finally { URL.revokeObjectURL(src); }
}

export async function removeCustom() {
  await delBlob();
  if (bgUrl) URL.revokeObjectURL(bgUrl);
  bgUrl = null; bgImg = null;
  setBgVars(null);
  if (current() === "custom") { store.set("theme", DEFAULT); await apply(DEFAULT); }
}

/** 导出图片用：自定义背景的 <img>（没有就 null） */
export async function bgImage() {
  if (current() !== "custom") return null;
  if (bgImg) return bgImg;
  const u = await loadBg();
  if (!u) return null;
  bgImg = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = u; });
  return bgImg;
}
