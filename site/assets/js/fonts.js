// 诗文字体：宋 / 楷 / 黑 / 仿宋。只加载选中的那一种（按需注入 <link>）。
// 思源宋体、思源黑体走 fonts.googleapis.cn（国内可达，按 unicode-range 分片，只下用到的字）；
// 霞鹜文楷只在选「楷」时才从 jsDelivr 取；仿宋只用系统字体。
// <head> 里的内联脚本会在首屏前读出选择并设好 data-font，避免闪烁。
import * as store from "./store.js";

const GF = "https://fonts.googleapis.cn/css2?family=";
export const FONTS = {
  song: { short: "宋", name: "宋体", family: "Noto Serif SC", href: GF + "Noto+Serif+SC:wght@400&display=swap" },
  kai:  { short: "楷", name: "楷体", family: "LXGW WenKai", href: "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-regular.css" },
  hei:  { short: "黑", name: "黑体", family: "Noto Sans SC", href: GF + "Noto+Sans+SC:wght@400&display=swap" },
  fang: { short: "仿宋", name: "仿宋", family: "STFangsong", href: "" },
};
export const DEFAULT = "song";

export function current() {
  const k = store.get("font", DEFAULT);
  return FONTS[k] ? k : DEFAULT;
}

function ensureLink(key) {
  const f = FONTS[key];
  if (!f || !f.href) return;
  const id = "font-" + key;
  if (document.getElementById(id)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.id = id; l.href = f.href;
  document.head.appendChild(l);
}

export function apply(key = current()) {
  if (!FONTS[key]) key = DEFAULT;
  ensureLink(key);
  if (key === DEFAULT) delete document.documentElement.dataset.font;
  else document.documentElement.dataset.font = key;
}

export function choose(key) {
  if (!FONTS[key]) return;
  store.set("font", key);
  apply(key);
}

// 本机有没有仿宋：用宽度比较法（与两种通用字体都不同才算装了）
let fangCache = null;
export function hasFangsong() {
  if (fangCache != null) return fangCache;
  try {
    const c = document.createElement("canvas").getContext("2d");
    const s = "吟诗仿宋春眠不觉晓abcmwi", size = "72px";
    const w = (fam) => { c.font = `${size} ${fam}`; return c.measureText(s).width; };
    const bases = ["monospace", "serif", "sans-serif"];
    fangCache = ["STFangsong", "FangSong", "FangSong_GB2312", "Fangsong SC"].some((f) =>
      bases.every((b) => w(`"${f}", ${b}`) !== w(b)));
  } catch { fangCache = false; }
  return fangCache;
}

// 导出图片 / 打印前，确保选中字体里要用到的字已经下好
export async function ready(text = "") {
  if (!document.fonts || !document.fonts.load) return;
  const f = FONTS[current()];
  const sample = Array.from(new Set(Array.from(text + "吟诗"))).join("");
  try {
    await Promise.race([
      document.fonts.load(`400 32px "${f.family}"`, sample),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
    await document.fonts.ready;
  } catch { /* 字体失败就用回退字体 */ }
}
