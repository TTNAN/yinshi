// 诗文字体（只作用于中间的诗笺 .card，见 yinshi.css 的 :root[data-font=…] .card；页面其余部分固定用默认朱雀仿宋）。只加载选中的那一种（按需注入 <link>），全部是开源授权（SIL OFL 1.1）的中文字体：
//   仿宋（默认）朱雀仿宋 —— 本站托管，按 unicode-range 分 92 片，只下载用到的字；
//   宋 思源宋体、黑 思源黑体、小薇 站酷小薇、毛笔 马善政楷书、快乐 站酷快乐、行书 龙藏 —— fonts.googleapis.cn（国内可达，按字分片）；
//   楷 霞鹜文楷 —— jsDelivr（按字分片）。
// 设置面板里每个按钮用它自己的字体显示名字：Google 字体只取按钮上那两个字（&text=，几 KB），
// 本站与 jsDelivr 的分片字体只会下载这两个字所在的分片。
// <head> 里的内联脚本会在首屏前读出选择并设好 data-font（和这里的 href 保持一致），避免闪烁。
import * as store from "./store.js";

const GF = "https://fonts.googleapis.cn/css2?family=";
export const FONTS = {
  fang:     { name: "仿宋", note: "朱雀仿宋", family: "Zhuque Fangsong", href: "fonts/zhuque-fangsong/zhuque-fangsong.css" },
  song:     { name: "宋体", note: "思源宋体", family: "Noto Serif SC", href: GF + "Noto+Serif+SC:wght@400&display=swap", gf: "Noto+Serif+SC:wght@400" },
  kai:      { name: "楷体", note: "霞鹜文楷", family: "LXGW WenKai", href: "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-regular.css" },
  hei:      { name: "黑体", note: "思源黑体", family: "Noto Sans SC", href: GF + "Noto+Sans+SC:wght@400&display=swap", gf: "Noto+Sans+SC:wght@400" },
  xiaowei:  { name: "小薇", note: "站酷小薇", family: "ZCOOL XiaoWei", href: GF + "ZCOOL+XiaoWei&display=swap", gf: "ZCOOL+XiaoWei" },
  mashan:   { name: "毛笔", note: "马善政楷书", family: "Ma Shan Zheng", href: GF + "Ma+Shan+Zheng&display=swap", gf: "Ma+Shan+Zheng" },
  kuaile:   { name: "快乐", note: "站酷快乐体", family: "ZCOOL KuaiLe", href: GF + "ZCOOL+KuaiLe&display=swap", gf: "ZCOOL+KuaiLe" },
  longcang: { name: "行书", note: "龙藏体", family: "Long Cang", href: GF + "Long+Cang&display=swap", gf: "Long+Cang" },
};
export const DEFAULT = "fang";

export function current() {
  const k = store.get("font", DEFAULT);
  return FONTS[k] ? k : DEFAULT;
}

function addCss(id, href) {
  if (document.getElementById(id)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.id = id; l.href = href;
  document.head.appendChild(l);
}
function ensureLink(key) {
  const f = FONTS[key];
  if (f && f.href) addCss("font-" + key, f.href);
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

// 设置面板打开时：给每个字体按钮载入预览用的一小份字形
export function loadPreviews() {
  for (const [k, f] of Object.entries(FONTS)) {
    if (f.gf) addCss("font-pv-" + k, `${GF}${f.gf}&text=${encodeURIComponent(f.name)}&display=swap`);
    else ensureLink(k);
  }
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
