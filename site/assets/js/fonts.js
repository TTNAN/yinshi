// 诗文字体（只作用于中间的诗笺 .card，见 yinshi.css 的 :root[data-font=…] .card；页面其余部分固定用默认朱雀仿宋）。只加载选中的那一种（按需注入 <link>），全部是开源授权（SIL OFL 1.1）的中文字体：
//   仿宋（默认）朱雀仿宋 —— 本站托管，按 unicode-range 分 92 片，只下载用到的字；
//   宋 思源宋体、黑 思源黑体、小薇 站酷小薇、毛笔 马善政楷书、快乐 站酷快乐、行书 龙藏 —— fonts.googleapis.cn（国内可达，按字分片）；
//   楷 霞鹜文楷 —— jsDelivr（按字分片）。
// 繁体字形：朱雀仿宋（v0.212 起）、思源宋 / 黑、霞鹜文楷都收了繁体；小薇、毛笔、快乐、行书四种只收 GB2312 简体字（约 6700 字），
// 也没有带繁体的开源版本。简体下偶尔缺的生僻字用 fb 指定的同类字体逐字补（小薇→思源宋体，快乐→思源黑体，毛笔 / 行书→霞鹜文楷，
// 在 yinshi.css 的字体栈里紧跟在后面）；繁体下几乎每首都缺好几个字，逐字补会一首诗里两种字体混排，
// 所以改为整首换：当前诗笺上只要有这种字体没有的字，整张诗笺换成 tfb 指定的同类、带繁体的字体（data-tfb），并在诗笺下方注明。
// tfb：小薇→思源宋体，毛笔 / 行书→霞鹜文楷，快乐→jf 粉圆（Huninn，圆体、收繁体，比思源黑体更接近快乐体）。补字字体都按字分片，只下载用到的字。
// 站酷小薇 v1.000 有 8 个字（回圃圄圊崮徊痼蛔）轮廓方向画错，显示成黑方块：本站托管一个只含这 8 个字的修补版 “Yinshi XiaoWei Fix”（fix），
// 排在字体栈最前面，只接管这 8 个字（tools/build-xiaowei-fix.py）。
// 设置面板里每个按钮用它自己的字体显示名字：Google 字体只取按钮上那两个字（&text=，几 KB），
// 本站与 jsDelivr 的分片字体只会下载这两个字所在的分片。
// <head> 里的内联脚本会在首屏前读出选择并设好 data-font（和这里的 href 保持一致），避免闪烁。
import * as store from "./store.js";

const GF = "https://fonts.googleapis.cn/css2?family=";
export const FONTS = {
  fang:     { name: "仿宋", note: "朱雀仿宋", family: "Zhuque Fangsong", href: "fonts/zhuque-fangsong/zhuque-fangsong.css?v=0.212", tc: "serif_tc" },
  song:     { name: "宋体", note: "思源宋体", family: "Noto Serif SC", href: GF + "Noto+Serif+SC:wght@400&display=swap", gf: "Noto+Serif+SC:wght@400", tc: "serif_tc" },
  kai:      { name: "楷体", note: "霞鹜文楷", family: "LXGW WenKai", href: "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-regular.css", tc: "kai_tc" },
  hei:      { name: "黑体", note: "思源黑体", family: "Noto Sans SC", href: GF + "Noto+Sans+SC:wght@400&display=swap", gf: "Noto+Sans+SC:wght@400", tc: "sans_tc" },
  xiaowei:  { name: "小薇", note: "站酷小薇", family: "ZCOOL XiaoWei", href: GF + "ZCOOL+XiaoWei&display=swap", gf: "ZCOOL+XiaoWei", fb: "song", tfb: "song",
              fix: { family: "Yinshi XiaoWei Fix", href: "fonts/zcool-xiaowei-fix/zcool-xiaowei-fix.css?v=cad48131" } },
  mashan:   { name: "毛笔", note: "马善政楷书", family: "Ma Shan Zheng", href: GF + "Ma+Shan+Zheng&display=swap", gf: "Ma+Shan+Zheng", fb: "kai", tfb: "kai" },
  kuaile:   { name: "快乐", note: "站酷快乐体", family: "ZCOOL KuaiLe", href: GF + "ZCOOL+KuaiLe&display=swap", gf: "ZCOOL+KuaiLe", fb: "hei", tfb: "huninn", extra: "啰擩瞭" },
  longcang: { name: "行书", note: "龙藏体", family: "Long Cang", href: GF + "Long+Cang&display=swap", gf: "Long+Cang", fb: "kai", tfb: "kai" },
};
// 只用作繁体整首替换的字体（不出现在设置里）
export const TRAD_ONLY = {
  huninn: { name: "粉圆", note: "jf 粉圆体", family: "Huninn", href: GF + "Huninn&display=swap", tc: "sans_tc" },
  // 繁体专用的同款字体：Google 版思源宋 / 黑 SC、霞鹜文楷简体版少收一些繁体字（如 鸛 鸝 灩 嶠），
  // 繁体下在字体栈里紧跟一份同一设计的 TC 版补上（只在繁体时载入样式表，用到才下载字形；简体下载量不变）
  serif_tc: { name: "思源宋体 TC", family: "Noto Serif TC", href: GF + "Noto+Serif+TC:wght@400&display=swap" },
  sans_tc:  { name: "思源黑体 TC", family: "Noto Sans TC", href: GF + "Noto+Sans+TC:wght@400&display=swap" },
  kai_tc:   { name: "霞鹜文楷 TC", family: "LXGW WenKai TC", href: GF + "LXGW+WenKai+TC&display=swap" },
};
const any = (k) => FONTS[k] || TRAD_ONLY[k];
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
let TRAD = false;
function ensureLink(key) {
  const f = any(key);
  if (f && f.href) addCss("font-" + key, f.href);
  if (f && f.fix) addCss("font-" + key + "-fix", f.fix.href);
  if (f && f.fb) ensureLink(f.fb);
  if (TRAD && f && f.tc) ensureLink(f.tc);
}
/** 切到繁体时调用：载入当前字体的繁体同款（TC）样式表 */
export function setTrad(on) {
  TRAD = !!on;
  if (TRAD) ensureLink(current());
}

// 这四种展示字体收的字 = GB2312 的 6763 个汉字，少 33 个（几种字体都一样；快乐体另多 3 个）。
// GB2312 字表不用另存：用浏览器自带的 GB18030 解码器把 B0A1–F7FE 解出来即可。
const GB_LACK = "劐坶塥弪憝戤桊毪牿犋猸瘭稆筢耠耢耥胲脶膪艴蒈蓰蟓赇蹯轷铴镩阢骣鲰齄";
let GB = null;
function gb2312() {
  if (GB) return GB;
  GB = new Set();
  try {
    const dec = new TextDecoder("gb18030");
    const bytes = [];
    for (let a = 0xB0; a <= 0xF7; a++) for (let b = 0xA1; b <= 0xFE; b++) bytes.push(a, b);
    for (const ch of dec.decode(new Uint8Array(bytes))) if (ch !== "\uFFFD") GB.add(ch);
    for (const ch of GB_LACK) GB.delete(ch);
  } catch { GB = null; return new Set(); }
  return GB;
}
const HAN_RE = /\p{Script=Han}/u;
/** 这段文字里，当前字体（只查有 tfb 的四种）没有字形的汉字；其他字体返回空数组 */
export function missing(key, text) {
  const f = FONTS[key];
  if (!f || !f.tfb) return [];
  const gb = gb2312();
  if (!gb.size) return [];
  const extra = f.extra || "";
  return [...new Set(Array.from(text || "").filter((ch) => HAN_RE.test(ch) && !gb.has(ch) && !extra.includes(ch)))];
}
/** 繁体下要不要整首换字体：返回 { key, name, note, family, miss } 或 null；需要时顺手载入替换字体 */
export function tradFallback(key, text) {
  const f = FONTS[key];
  if (!f || !f.tfb) return null;
  const miss = missing(key, text);
  if (!miss.length) return null;
  ensureLink(f.tfb);
  const t = any(f.tfb);
  return { key: f.tfb, name: t.name, note: t.note, family: t.family, miss };
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
  const card = document.getElementById("poem");
  const tfb = card && card.dataset.tfb && any(card.dataset.tfb);
  const tcs = TRAD ? [f.tc, f.fb && FONTS[f.fb].tc, tfb && tfb.tc].filter(Boolean).map((k) => any(k).family) : [];
  const fams = (f.fix ? [f.fix.family] : []).concat([f.family]).concat(f.fb ? [FONTS[f.fb].family] : []).concat(tfb ? [tfb.family] : []).concat(tcs)
    .map((n) => `"${n}"`).join(", ");
  try {
    await Promise.race([
      document.fonts.load(`400 32px ${fams}`, sample),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
    await document.fonts.ready;
  } catch { /* 字体失败就用回退字体 */ }
}
