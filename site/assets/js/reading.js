// 注音：pinyin-pro 出基础读音 → 课本修正 → 吟诵旧读 → 用户自定义
const PP = window.pinyinPro;
export const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}]/u;

let FIX = { textbook: [], recite: [] };

export function loadFixes(json) {
  const compile = (list) => (list || []).map((e) => {
    const at = e.p.indexOf("[");
    const ctx = e.p.replace(/[[\]]/g, "");
    return { ctx, at: Array.from(e.p.slice(0, at)).length, r: e.r, note: e.note || "" };
  }).filter((e) => e.ctx && e.at >= 0);
  FIX = { textbook: compile(json.textbook), recite: compile(json.recite) };
}

function baseReadings(line) {
  const chars = Array.from(line);
  let arr = null;
  try { arr = PP.pinyin(line, { type: "all", toneSandhi: false }); } catch { arr = null; }
  if (!arr || arr.length !== chars.length) {
    arr = chars.map((ch) => (HAN.test(ch) ? { origin: ch, pinyin: PP.pinyin(ch, { toneSandhi: false }), isZh: true } : { origin: ch, pinyin: "", isZh: false }));
  }
  return chars.map((ch, i) => ({ ch, py: HAN.test(ch) ? (arr[i].pinyin || "") : "", han: HAN.test(ch) }));
}

function applyFixes(cells, line, list, set) {
  for (const f of list) {
    let from = 0, idx;
    while ((idx = line.indexOf(f.ctx, from)) !== -1) {
      const ci = Array.from(line.slice(0, idx)).length + f.at;
      if (cells[ci] && cells[ci].han) { cells[ci].py = f.r; cells[ci].fix = { set, note: f.note, r: f.r }; }
      from = idx + 1;
    }
  }
}

/**
 * @param {string[]} lines 诗行（包括标题时用 key 前缀区分）
 * @param {{textbook:boolean, recite:boolean, overrides:Object, prefix:string, hi:string}} o
 */
export function annotate(lines, o) {
  return lines.map((line, li) => {
    const cells = baseReadings(line);
    cells.forEach((c) => { c.base = c.py; });
    if (o.textbook) applyFixes(cells, line, FIX.textbook, "textbook");
    if (o.recite) applyFixes(cells, line, FIX.recite, "recite");
    cells.forEach((c, ci) => {
      c.key = `${o.prefix || ""}${li}:${ci}`;
      c.auto = c.py;
      const ov = o.overrides && o.overrides[c.key];
      if (ov && c.han) { c.py = ov; c.ov = true; }
      if (o.hi && c.ch === o.hi) c.hl = true;
    });
    return cells;
  });
}

// 某字可选读音：pinyin-pro 多音字表 ∪ 修正表里出现过的读音 ∪ 当前读音
export function optionsFor(cell) {
  const set = new Set();
  try { (PP.polyphonic(cell.ch, { type: "array", toneSandhi: false })[0] || []).forEach((p) => p && set.add(p)); } catch { /* ignore */ }
  for (const f of [...FIX.textbook, ...FIX.recite]) {
    const ch = Array.from(f.ctx)[f.at];
    if (ch === cell.ch) set.add(f.r);
  }
  [cell.base, cell.auto, cell.py].forEach((p) => p && set.add(p));
  return [...set];
}

// 把 "lv3" / "lü3" / "ma" 之类转成带调号；已有调号原样返回
const TONES = { a: "āáǎà", o: "ōóǒò", e: "ēéěè", i: "īíǐì", u: "ūúǔù", "ü": "ǖǘǚǜ" };
export function normalizePinyin(input) {
  let s = String(input || "").trim().toLowerCase().replace(/v/g, "ü").replace(/u:/g, "ü");
  if (!/^[a-zü\u0300-\u036f āáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜ]+[0-5]?$/.test(s)) return "";
  const m = s.match(/^(.*?)([0-5])$/);
  if (!m) return s;
  let [, syl, t] = m; t = +t;
  if (t === 0 || t === 5) return syl;
  let pos = -1;
  if (syl.includes("a")) pos = syl.indexOf("a");
  else if (syl.includes("e")) pos = syl.indexOf("e");
  else if (syl.includes("ou")) pos = syl.indexOf("o");
  else { for (let i = syl.length - 1; i >= 0; i--) if ("iouü".includes(syl[i])) { pos = i; break; } }
  if (pos < 0) return syl;
  return syl.slice(0, pos) + TONES[syl[pos]][t - 1] + syl.slice(pos + 1);
}
