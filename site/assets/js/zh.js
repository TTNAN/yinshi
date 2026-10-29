// 简 ↔ 繁：用本地托管的 opencc-js（MIT；词典数据 Apache-2.0），只在切到繁体时才加载。
// 注音始终按简体算（pinyin-pro 与课本读音修正表都是简体），再把繁体字一一对位显示，
// 所以转换必须逐字对齐：整行转换后字数变了，就退回逐字转换。
let conv = null, loading = null;

export function ready() { return !!conv; }

export function load() {
  if (conv) return Promise.resolve(true);
  if (!loading) {
    loading = import("../../vendor/opencc-js-1.4.2/opencc-full.esm.js").then((O) => {
      conv = { s2t: O.Converter({ from: "cn", to: "t" }), t2s: O.Converter({ from: "t", to: "cn" }) };
      return true;
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

function aligned(fn, s) {
  s = String(s == null ? "" : s);
  if (!conv || !s) return s;
  const out = fn(s);
  if (Array.from(out).length === Array.from(s).length) return out;
  return Array.from(s).map((c) => { const o = fn(c); return Array.from(o).length === 1 ? o : c; }).join("");
}

/** 简 → 繁（OpenCC 标准繁体，带词组，逐字对齐） */
export const s2t = (s) => aligned(conv ? conv.s2t : null, s);
/** 繁 → 简（逐字对齐） */
export const t2s = (s) => aligned(conv ? conv.t2s : null, s);
