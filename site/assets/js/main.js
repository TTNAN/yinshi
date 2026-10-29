// 吟诗 · 主程序
import * as store from "./store.js";
import * as api from "./api.js";
import { loadFixes, annotate, optionsFor, normalizePinyin, HAN } from "./reading.js";
import { renderPoem, fit } from "./render.js";
import { cardToPNG, download, poemToText, copyText } from "./exporter.js";
import * as fonts from "./fonts.js";
import * as zh from "./zh.js";
import * as themes from "./themes.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hanOnly = (s) => Array.from(String(s || "")).filter((c) => HAN.test(c)).join("");
const baseTitle = (t) => String(t || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
const isMobile = () => window.matchMedia("(max-width: 760px)").matches;

const MODES = { h: "横排", v: "竖排", g: "田字格" };
// 显示大小：字号乘在自适应字号上；拼音为相对汉字的比例；行距为相对字号的间距
const DISPLAY = {
  size: { s: ["小", .85], m: ["中", 1], l: ["大", 1.25], xl: ["特大", 1.5] },
  py: { s: ["小", .3], m: ["中", .345], l: ["大", .4] },
  lh: { tight: ["紧凑", .08], normal: ["适中", .18], loose: ["宽松", .38] },
};
const DISPLAY_DEFAULT = { size: "m", py: "m", lh: "normal" };
const FALLBACK_DYN = api.DYN_ORDER;
// 筛选面板「诗人」的常用候选
const POETS = ["李白", "杜甫", "白居易", "王维", "苏轼", "李清照", "辛弃疾", "陆游", "杜牧", "李商隐", "孟浩然", "王安石", "刘禹锡", "柳宗元",
  "岑参", "王昌龄", "贺知章", "范仲淹", "欧阳修", "纳兰性德", "杨万里", "陶渊明", "韩愈", "高适", "王之涣", "李贺", "柳永", "晏殊", "秦观", "曹操"];
const LANGS = { hans: ["简体", "zh-Hans"], hant: ["繁體", "zh-Hant"] };
const FALLBACK_TYPE = Object.keys(api.TYPES);   // 诗 / 词 / 曲

let DAILY = [];
const VQ = (() => { const v = new URL(import.meta.url).searchParams.get("v"); return v ? "?v=" + v : ""; })();
const state = {
  poem: null, alt: null,
  view: { mode: store.get("mode", "h"), vdir: store.get("vdir", "rl") === "lr" ? "lr" : "rl", pinyin: store.get("pinyin", true), veil: false, veiled: new Set(), today: false, tag: "", hi: "" },
  settings: Object.assign({ textbook: true, recite: false }, store.get("settings", {})),
  display: Object.assign({}, DISPLAY_DEFAULT, store.get("display", {})),
  filters: Object.assign({ dynasty: "", types: [], author: "" }, store.get("filters", {})),
  ann: null,
  search: { q: "", page: 1, local: [], remote: [], author: null },
  lang: store.get("lang", "hans") === "hant" ? "hant" : "hans",
};
api.setLang(LANGS[state.lang][1]);
// 旧版筛选（诗泉的朝代名、「五言绝句」等体裁）换成主诗库的叫法
(() => {
  const f = state.filters;
  if (api.DYN_FROM_OLD[f.dynasty]) f.dynasty = api.DYN_FROM_OLD[f.dynasty];
  if (f.dynasty && !api.DYN_ORDER.includes(f.dynasty)) f.dynasty = "";
  f.types = (Array.isArray(f.types) ? f.types : []).filter((t) => api.TYPES[t]);
})();
if (!MODES[state.view.mode]) state.view.mode = "h";
Object.keys(DISPLAY).forEach((k) => { if (!DISPLAY[k][state.display[k]]) state.display[k] = DISPLAY_DEFAULT[k]; });

function applyDisplay() {
  const root = $("poemView"), d = state.display;
  root.dataset.fs = DISPLAY.size[d.size][1];
  root.style.setProperty("--fs", DISPLAY.size[d.size][1]);
  root.style.setProperty("--pyr", DISPLAY.py[d.py][1]);
  root.style.setProperty("--lg", DISPLAY.lh[d.lh][1]);
}

/* ---------------- 提示 ---------------- */
let toastTimer;
function toast(msg, ms = 2400) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

/* ---------------- 今日一诗 ---------------- */
function todayIndex() {
  const now = new Date();
  const start = new Date(2026, 0, 1);
  const days = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - start) / 864e5);
  return ((days % DAILY.length) + DAILY.length) % DAILY.length;
}
function dailyPoem(i) {
  const d = DAILY[i];
  return { id: "d" + i, title: d.t, author: d.a, dynasty: d.d, type: "", lines: d.lines.slice(), source: "daily", dailyIndex: i };
}
function findTextbook(p) {
  const bt = baseTitle(p.title);
  const i = DAILY.findIndex((d) => d.a === p.author && (baseTitle(d.t) === bt || d.t === p.title));
  return i < 0 ? null : dailyPoem(i);
}

/* ---------------- 作者生平 / 本诗赏析（静态数据，按需载入） ---------------- */
let NOTES = null, POET_INFO = null, NOTES_BY_FIRST = new Map(), sideLoading = null;
function loadSide() {
  if (!sideLoading) {
    sideLoading = Promise.all([
      fetch("data/poets.json" + VQ).then((r) => r.json()),
      fetch("data/notes.json" + VQ).then((r) => r.json()),
    ]).then(([p, n]) => {
      POET_INFO = p.poets || p; NOTES = n.notes || n;
      // 诗名写法不同（如「鼓吹曲辞 将进酒」「水调歌头·明月几时有」）时按 作者 + 首句前五字 对上
      NOTES_BY_FIRST = new Map(Object.entries(NOTES).filter(([, v]) => v.f).map(([k, v]) => [k.split("|")[1] + "|" + v.f, v]));
    }).catch((e) => { sideLoading = null; throw e; });
  }
  return sideLoading;
}
const noteKey = (t, a) => String(t || "").replace(/\s+/g, "") + "|" + a;
export function noteFor(p) {
  if (!NOTES || !p) return null;
  const s = view(p).simp;
  return NOTES[noteKey(s.title, s.author)] || NOTES[noteKey(baseTitle(s.title), s.author)]
    || NOTES_BY_FIRST.get(s.author + "|" + hanOnly(s.lines.join("")).slice(0, 5)) || null;
}
let sideSeq = 0;
async function drawSide() {
  const p = state.poem;
  const au = $("sideAu"), no = $("sideNote");
  if (!p) return;
  const seq = ++sideSeq;
  try { await loadSide(); } catch { au.hidden = no.hidden = true; return; }
  if (seq !== sideSeq) return;
  const s = view(p).simp;
  const D = (x) => esc(toDisp(x || ""));
  const poet = POET_INFO[s.author];
  let auHTML = "";
  if (poet) {
    const meta = [poet.d, poet.y].filter(Boolean).join(" · ");
    auHTML = `<p class="au-name">${D(s.author)}</p><p class="au-meta">${D(meta)}${poet.zi ? "<br>" + D(poet.zi) : ""}</p><p>${D(poet.bio)}</p>`
      + (poet.works && poet.works.length ? `<h4>代表作</h4><div class="au-works">${poet.works.map((w) => `<button type="button" data-side-search="${esc(w)}">${D(w)}</button>`).join("")}</div>` : "");
  } else if (s.author && !/佚名|无名氏|民歌|乐府/.test(s.author)) {
    auHTML = `<p class="au-name">${D(s.author)}</p><p class="au-meta">${D(s.dynasty)}</p><p class="muted">暂无这位诗人的介绍</p>`;
    api.authorInfo(s.author, s.dynasty).then((a) => {
      if (seq !== sideSeq || !a || !(a.birth || a.death)) return;
      const m = au.querySelector(".au-meta");
      if (m) m.textContent = toDisp([a.dynasty || s.dynasty, `${a.birth || "？"}—${a.death || "？"}`].filter(Boolean).join(" · "));
    });
  } else if (s.author) {
    auHTML = `<p class="au-name">${D(s.author)}</p><p class="au-meta">${D(s.dynasty)}</p>`;
  }
  $("sideAuBody").innerHTML = auHTML;
  au.hidden = !auHTML;
  const n = noteFor(p);
  if (n) {
    $("sideNoteBody").innerHTML = [n.yi && `<h4>诗意</h4><p>${D(n.yi)}</p>`, n.qing && `<h4>情感</h4><p>${D(n.qing)}</p>`, n.bei && `<h4>创作背景</h4><p>${D(n.bei)}</p>`].filter(Boolean).join("");
    no.hidden = false; no.classList.remove("empty");
  } else {
    $("sideNoteBody").innerHTML = `<p class="muted">暂无赏析</p>`;
    no.hidden = false; no.classList.add("empty");
  }
}
function toggleSide(sec) {
  const open = !sec.classList.contains("open");
  sec.classList.toggle("open", open);
  sec.querySelector(".side-toggle").setAttribute("aria-expanded", String(open));
}

/* ---------------- 简 / 繁 ---------------- */
const hant = () => state.lang === "hant" && zh.ready();
// 一首诗的两个版本：disp 是按当前简繁显示的文字，simp 是简体（用来注音、对课本、记自定义读音）
function view(p) {
  if (!p) return { disp: p, simp: p };
  const from = p.lang || "hans";
  const conv = (fn) => ({ ...p, title: fn(p.title), author: fn(p.author), dynasty: fn(p.dynasty), type: fn(p.type), lines: p.lines.map(fn) });
  const simp = from === "hant" && zh.ready() ? conv(zh.t2s) : p;
  const disp = hant() ? (from === "hant" ? p : conv(zh.s2t)) : simp;
  return { disp, simp };
}
const toSimp = (s) => (zh.ready() ? zh.t2s(s) : s);
const toApi = (s) => (hant() ? zh.s2t(s) : s);           // 发给诗库的查询词
const toDisp = (s) => (hant() ? zh.s2t(s) : s);          // 界面上显示的诗文
const sameName = (a, b) => toSimp(a) === toSimp(b);

/* ---------------- 诗 → 屏幕 ---------------- */
// 「赋得古原草送别（节选）」→ 主标题 + 小注「节选」
export function splitTitle(t) {
  const m = String(t || "").match(/^(.*?)[（(]([^）)]*)[）)]\s*$/);
  return m && m[1].trim() ? { main: m[1].trim(), sub: m[2].trim() } : { main: String(t || "").trim(), sub: "" };
}
function ovKey(p) { const s = view(p).simp; return "ov:" + store.hash(s.title + "|" + s.author + "|" + s.lines.join("/")); }
function overrides() { return state.poem ? store.get(ovKey(state.poem), {}) : {}; }

function setPoem(p, opts = {}) {
  state.poem = p;
  state.view.hi = opts.hi || "";
  state.view.today = p.source === "daily" && p.dailyIndex === todayIndex();
  state.view.tag = p.source === "daily" ? "小学必背" : (p.type && p.type !== "其他" ? p.type : "诗库");
  state.view.veiled = new Set(state.view.veil ? p.lines.map((_, i) => i) : []);
  state.alt = opts.alt !== undefined ? opts.alt : null;
  if (p.source === "api" && opts.alt === undefined) {
    const s = view(p).simp;
    const tb = findTextbook(s);
    if (tb && hanOnly(tb.lines.join("")) !== hanOnly(s.lines.join(""))) state.alt = { poem: tb, from: p, toTextbook: true };
  }
  draw(true);
  closeSheet(); closePop();
  if (opts.focus !== false && !isMobile()) $("poem").focus({ preventScroll: true });
  if (isMobile()) window.scrollTo({ top: 0, behavior: "smooth" });
}

function draw(animate = false) {
  const p = state.poem;
  if (!p) return;
  const { disp, simp } = view(p);
  state.disp = disp;
  const o = { textbook: state.settings.textbook, recite: state.settings.recite, overrides: overrides(), hi: toSimp(state.view.hi) };
  // 按简体注音，再换上当前简繁的字形（逐字对齐）
  state.ann = {
    title: glyphs(annotate([splitTitle(simp.title).main], { ...o, prefix: "t", hi: "" }), [splitTitle(disp.title).main]),
    lines: glyphs(annotate(simp.lines, o), disp.lines),
  };
  applyDisplay();
  renderPoem($("poemView"), disp, state.ann, { ...state.view, hi: toDisp(state.view.hi), animate, sub: splitTitle(disp.title).sub, authorKey: simp.author });
  // 底注：课本版切换
  const note = $("cardNote");
  if (state.alt) {
    note.hidden = false;
    note.innerHTML = state.alt.toTextbook
      ? `<span>诗库里的文字和课本不太一样</span><button class="btn ghost" type="button" data-alt>改用课本版</button>`
      : `<span>当前为课本版</span><button class="btn ghost" type="button" data-alt>改回诗库版</button>`;
  } else { note.hidden = true; note.innerHTML = ""; }
  document.title = `${disp.title} · ${disp.author ? disp.author + " · " : ""}吟诗`;
  syncControls();
  drawSide();
}

function glyphs(ann, lines) {
  ann.forEach((cells, i) => {
    const chars = Array.from(lines[i] || "");
    if (chars.length !== cells.length) return;
    cells.forEach((c, j) => { c.ch = chars[j]; });
  });
  return ann;
}

function syncControls() {
  const v = state.view;
  document.querySelectorAll("#modeSeg [data-mode]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === v.mode)));
  $("togPinyin").setAttribute("aria-pressed", String(v.pinyin));
  $("togVeil").setAttribute("aria-pressed", String(v.veil));
  $("dPinyin").setAttribute("aria-pressed", String(v.pinyin));
  $("dVeil").setAttribute("aria-pressed", String(v.veil));
  $("dModeLabel").textContent = MODES[v.mode];
  const f = state.filters;
  document.querySelector("#btnFilter .dot").hidden = !(f.dynasty || f.types.length || f.author);
}

/* ---------------- 阅读方式 ---------------- */
function setMode(m) {
  state.view.mode = m; store.set("mode", m); draw(true);
}
function setPinyin(on) {
  state.view.pinyin = on; store.set("pinyin", on);
  $("poemView").classList.toggle("no-py", !on); syncControls();
}
function setVeil(on) {
  state.view.veil = on;
  state.view.veiled = new Set(on && state.poem ? state.poem.lines.map((_, i) => i) : []);
  draw(false);
  if (on) toast("点一句，显示或遮住");
}

/* ---------------- 本地检索（课本精选） ---------------- */
function localSearch(q) {
  const k = toSimp(q).replace(/[\s，。！？、；：,.!?]/g, "");
  if (!k) return [];
  const hits = [];
  DAILY.forEach((d, i) => {
    const text = d.lines.join("");
    let score = 0;
    if (d.t === k || baseTitle(d.t) === k) score = 100;
    else if (d.t.includes(k)) score = 80;
    else if (d.a === k) score = 60;
    else if (hanOnly(text).includes(hanOnly(k)) && hanOnly(k)) score = 40;
    if (score) hits.push({ score, p: dailyPoem(i) });
  });
  return hits.sort((a, b) => b.score - a.score).map((h) => h.p);
}

/* ---------------- 搜索弹层 ---------------- */
function openSheet(q = "") {
  const sheet = $("sheet");
  if (sheet.hidden) {
    sheet.hidden = false; $("scrim").hidden = false;
    document.body.classList.add("sheet-open");
  }
  if (q !== undefined) { $("q2").value = q; }
  if (isMobile()) setTimeout(() => $("q2").focus(), 60);
}
function closeSheet() {
  if ($("sheet").hidden) return;
  $("sheet").hidden = true; $("scrim").hidden = true;
  document.body.classList.remove("sheet-open");
}

function hl(text, q) {
  const k = hanOnly(q) || q;
  if (!k) return esc(text);
  const i = text.indexOf(k);
  return i < 0 ? esc(text) : esc(text.slice(0, i)) + "<mark>" + esc(k) + "</mark>" + esc(text.slice(i + k.length));
}
function firstLineWith(p, q) {
  const k = hanOnly(q);
  return (k && p.lines.find((l) => hanOnly(l).includes(k))) || p.lines[0] || "";
}

const poemKey = (p) => { const s = view(p).simp; return baseTitle(s.title) + "|" + s.author; };
// 列表去重用：同一位诗人常有多首同名诗（如「绝句」「杂诗」），再加首句前几个字区分
const itemKey = (p) => { const s = view(p).simp; return s.author + "|" + hanOnly(s.lines.join("")).slice(0, 12); };
function resItem(p, i, q, badge) {
  const d = view(p).disp;
  q = toDisp(q);
  return `<li><button class="res" type="button" data-i="${i}">
      <span class="res-t">${hl(d.title || "（无题）", q)}${badge ? `<span class="res-badge">${badge}</span>` : ""}</span>
      <span class="res-m">${esc(d.author)}${d.dynasty ? " · " + esc(d.dynasty) : ""}</span>
      <span class="res-l">${hl(firstLineWith(d, q), q)}</span>
    </button></li>`;
}
function renderResults() {
  const { q, local, remote, author } = state.search;
  const ol = $("results");
  const au = author && author.list.length ? author : null;
  const items = [];
  const html = [];
  const push = (p, badge, hq = q) => { html.push(resItem(p, items.length, hq, badge)); items.push(p); };
  if (au) {
    // 课本精选（小小一节）→ 「某某的诗」（可一直加载更多）→ 诗名与诗句
    const top = local.slice(0, 6);
    const topKeys = new Set(local.map(poemKey));      // 课本里有的诗只出现一次，用课本文字
    if (top.length) { html.push(`<li class="res-sec">课本精选</li>`); top.forEach((p) => push(p, "课本")); }
    const name = toDisp(au.name);
    html.push(`<li class="res-sec res-sec-au">${esc(name)}的诗${au.total ? `<small>共 ${au.total} 首</small>` : ""}</li>`);
    au.list.filter((p) => !topKeys.has(poemKey(p))).forEach((p) => push(p, "", ""));
    if (au.hasMore) html.push(`<li class="res-more"><button class="btn text" type="button" data-more-author ${au.loading ? "disabled" : ""}>${au.loading ? "正在翻…" : `加载更多 ${esc(name)} 的诗（已显示 ${au.list.length}${au.total ? " / " + au.total : ""}）`}</button></li>`);
    const rest = local.slice(6);
    if (rest.length || remote.length) html.push(`<li class="res-sec">诗名与诗句</li>`);
    rest.forEach((p) => push(p, "课本"));
    remote.forEach((p) => push(p, ""));
  } else {
    local.forEach((p) => push(p, "课本"));
    remote.forEach((p) => push(p, ""));
  }
  if (!items.length) { ol.innerHTML = q ? "" : `<li class="res-empty">输入诗名、诗句或诗人，回车搜索整个诗库</li>`; ol._items = []; return; }
  ol.innerHTML = html.join("");
  ol._items = items;
}

function setStatus(html) { $("sheetStatus").innerHTML = html; }

let liveTimer;
function liveSearch(q) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    state.search = { q, page: 1, local: localSearch(q), remote: [], author: null };
    renderResults();
    $("btnMore").hidden = true;
    if (!q) setStatus("");
    else setStatus(state.search.local.length ? `课本精选里有 ${state.search.local.length} 首 · 回车搜整个诗库` : "回车搜整个诗库");
  }, 220);
}

async function fullSearch(q, page = 1) {
  q = q.trim();
  clearTimeout(liveTimer);
  if (!q) return;
  openSheet(isMobile() ? q : undefined);
  const k = toSimp(hanOnly(q));
  // 2–4 个字、像人名：同时按诗人搜，有就单列一节「某某的诗」
  const asAuthor = page === 1 && Array.from(k).length >= 2 && Array.from(k).length <= 4 && k === toSimp(q.replace(/\s+/g, ""));
  if (page === 1) state.search = { q, page: 1, local: localSearch(q), remote: [], author: null };
  renderResults();
  setStatus(`<span class="loading">正在翻诗库…</span>`);
  $("btnMore").hidden = true;
  const [sr, ar] = await Promise.allSettled([
    api.search(toApi(q), page),
    asAuthor ? api.authorPoems(k, 1) : Promise.resolve(null),
  ]);
  if (state.search.q !== q) return;   // 期间又搜了别的
  if (ar.status === "fulfilled" && ar.value && ar.value.list.length) {
    const v = ar.value;
    state.search.author = { name: k, list: v.list, page: 1, hasMore: v.hasMore, total: v.total, keys: new Set(v.list.map(itemKey)) };
  }
  const au = state.search.author;
  // 诗人那一节已经列了的，不在「诗名与诗句」里重复；作者就是这位诗人的也交给那一节
  const skip = (p) => au && (au.keys.has(itemKey(p)) || sameName(p.author, k));
  const seen = new Set(state.search.local.map(poemKey));
  let hasMore = false;
  if (sr.status === "fulfilled") {
    const fresh = sr.value.list.filter((p) => !seen.has(poemKey(p)) && !skip(p));
    const have = new Set(state.search.remote.map(itemKey));
    state.search.remote = page === 1 ? fresh : state.search.remote.concat(fresh.filter((p) => !have.has(itemKey(p))));
    state.search.page = page;
    hasMore = sr.value.hasMore;
    state.search.total = sr.value.total;
  }
  renderResults();
  $("btnMore").hidden = !hasMore;
  const n = new Set([...state.search.local, ...state.search.remote, ...(au ? au.list : [])].map(itemKey)).size;
  if (sr.status === "fulfilled" || au) {
    const auLine = au ? `${esc(toDisp(au.name))}的诗${au.total ? ` ${au.total} 首` : ""}` : "";
    if (sr.status === "fulfilled" && sr.value.sampled) {
      // 单字：诗库按诗名、诗人检索，至少两个字；这里随机抽了几首含这个字的诗，再给个飞花令入口
      const fh = `<button class="btn ghost" type="button" data-act="feihua" data-v="${esc(k)}">飞花令「${esc(toDisp(k))}」再来一首</button>`;
      const c = esc(toDisp(k)), m = sr.value.list.length;
      const lead = m ? `随机挑了 ${m} 首含「${c}」的诗，点一首读` : n ? `课本里有 ${n} 首含「${c}」的诗，点一首读` : `玩飞花令，随机读一首含「${c}」的诗`;
      setStatus(`${lead}<br><small>搜诗名、诗人请输入两个字以上</small><br>${fh}`);
      return;
    }
    setStatus(n ? (au ? `${auLine} · 点一首读` : `找到 ${n}${hasMore ? "+" : ""} 首，点一首读`) : `没有找到「${esc(q)}」，换个说法试试`);
    return;
  }
  const e = sr.reason || {};
  if (e.kind === "short") {
    // 主诗库连不上、备用诗库不支持一两个字的全文搜索：给出能用的去处
    const btns = [];
    if (asAuthor) btns.push(`<button class="btn ghost" type="button" data-act="author" data-v="${esc(k)}">随机一首「${esc(toDisp(k))}」的诗</button>`);
    if (Array.from(k).length === 1) btns.push(`<button class="btn ghost" type="button" data-act="feihua" data-v="${esc(k)}">飞花令「${esc(toDisp(k))}」</button>`);
    const lead = n ? `找到 ${n} 首。` : "";
    setStatus(`${lead}${esc(e.message)}，可以多输几个字。${btns.length ? "<br>" + btns.join("") : ""}`);
    return;
  }
  setStatus(`${esc(e.message || "搜索失败")}${n ? " · 先看看找到的这些" : ""}`);
}

async function moreAuthor() {
  const au = state.search.author;
  if (!au || au.loading) return;
  au.loading = true; renderResults();
  try {
    const r = await api.authorPoems(au.name, au.page + 1);
    const fresh = r.list.filter((p) => !au.keys.has(itemKey(p)));
    fresh.forEach((p) => au.keys.add(itemKey(p)));
    au.list = au.list.concat(fresh);
    au.page += 1; au.hasMore = r.hasMore; if (r.total) au.total = r.total;
    state.search.remote = state.search.remote.filter((p) => !au.keys.has(itemKey(p)));
  } catch (e) { toast(e.message || "加载失败"); }
  finally { au.loading = false; renderResults(); }
}

// 「更多 某某 的诗」：打开搜索层，列出这位诗人的诗
function authorSearch(name) {
  closePop();
  $("q").value = toDisp(name); $("q2").value = toDisp(name);
  openSheet(toDisp(name));
  fullSearch(toDisp(name));
}

/* ---------------- 随机 / 飞花令 ---------------- */
let busy = false;
async function doRandom(params = null) {
  if (busy) return;
  busy = true;
  const f = state.filters;
  const p = params || { dynasty: f.dynasty, type: f.types, author: f.author };
  const q = {};
  Object.entries(p).forEach(([k, v]) => { q[k] = Array.isArray(v) ? v.map(toApi) : (v ? toApi(v) : v); });
  setBusy(true);
  try {
    const poem = await api.random(q);
    if (!poem || !poem.lines.length) { toast(p.author ? `诗库里没找到「${toDisp(p.author)}」的诗` : "这个条件下没有找到诗，换个条件试试"); return; }
    setPoem(poem);
  } catch (e) {
    const pool = p.author ? DAILY.map((_, i) => i).filter((i) => DAILY[i].a === toSimp(p.author)) : DAILY.map((_, i) => i);
    if (pool.length) {
      let i = pool[Math.floor(Math.random() * pool.length)];
      if (state.poem && state.poem.dailyIndex === i && pool.length > 1) i = pool[(pool.indexOf(i) + 1) % pool.length];
      setPoem(dailyPoem(i));
    }
    toast(`${e.message}${pool.length ? "，先读一首课本里的" : ""}`, 3200);
  } finally { busy = false; setBusy(false); }
}

async function doFeihua(ch) {
  ch = Array.from(ch || "").find((c) => HAN.test(c));
  if (!ch) { toast("请输入一个汉字"); return; }
  closePop();
  if (busy) return;
  busy = true; setBusy(true);
  store.set("fh", ch);
  try {
    const poem = await api.random({ char: toApi(ch) });
    if (!poem || !poem.lines.length) throw new api.ApiError("empty", `诗库里没找到含「${toDisp(ch)}」的诗`);
    setPoem(poem, { hi: ch });
  } catch (e) {
    const sc = toSimp(ch);
    const pool = DAILY.map((_, i) => i).filter((i) => DAILY[i].lines.join("").includes(sc));
    if (pool.length) setPoem(dailyPoem(pool[Math.floor(Math.random() * pool.length)]), { hi: ch });
    toast(`${e.message}${pool.length ? "，先从课本里找一首" : ""}`, 3200);
  } finally { busy = false; setBusy(false); }
}

function setBusy(on) {
  ["btnRandom", "btnFeihua", "dRandom", "dFeihua", "btnFilterGo"].forEach((id) => { $(id).disabled = on; });
  $("poem").setAttribute("aria-busy", String(on));
}

/* ---------------- 浮层 ---------------- */
let popAnchor = null;
function openPop(html, anchor, { sheetOnMobile = false, cls = "" } = {}) {
  const pop = $("pop");
  pop.innerHTML = html; pop.hidden = false; pop.className = "pop " + cls;
  popAnchor = anchor;
  if (anchor) anchor.setAttribute("aria-expanded", "true");
  if (sheetOnMobile && isMobile()) { pop.classList.add("as-sheet"); pop.style.left = ""; pop.style.top = ""; return pop; }
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
  let top = r.bottom + 8;
  if (top + ph > window.innerHeight - 12 - (isMobile() ? 62 : 0)) top = Math.max(12, r.top - ph - 8);
  pop.style.left = left + "px"; pop.style.top = top + "px";
  return pop;
}
function closePop() {
  const pop = $("pop");
  if (pop.hidden) return;
  pop.hidden = true; pop.innerHTML = "";
  if (popAnchor) { popAnchor.setAttribute("aria-expanded", "false"); popAnchor.classList.remove("on"); }
  popAnchor = null;
}

function findCell(key) {
  const all = [...state.ann.title, ...state.ann.lines].flat();
  return all.find((c) => c.key === key);
}

function charPop(el) {
  const cell = findCell(el.dataset.k);
  if (!cell) return;
  if (popAnchor === el) { closePop(); return; }
  closePop();
  el.classList.add("on");
  const opts = optionsFor(cell);
  const setName = { textbook: "课本读音修正", recite: "吟诵旧读" };
  const note = cell.ov ? `已自定义（默认 ${esc(cell.auto)}），本诗会记住。`
    : cell.fix ? `${setName[cell.fix.set]}：${esc(cell.fix.note)}`
    : opts.length > 1 ? "多音字，按上下文自动选了一个读音。" : "";
  const pop = openPop(`
    <h3><b>${esc(cell.ch)}</b><span>选择读音</span></h3>
    <div class="opts">${opts.map((p) => `<button class="opt" type="button" data-py="${esc(p)}" aria-pressed="${p === cell.py}">${esc(p)}</button>`).join("")}</div>
    ${note ? `<p class="pop-note">${note}</p>` : ""}
    <form class="pop-row" data-custom>
      <input type="text" placeholder="其他读音，如 xia2" aria-label="自定义读音" autocomplete="off" autocapitalize="off" spellcheck="false">
      <button class="btn solid" type="submit">确定</button>
    </form>
    ${cell.ov ? `<div class="pop-row"><button class="btn text" type="button" data-reset>恢复默认读音</button></div>` : ""}
  `, el, { cls: "pop-char" });
  pop.dataset.k = cell.key;
  const cur = pop.querySelector('.opt[aria-pressed="true"]') || pop.querySelector(".opt");
  if (cur) cur.focus({ preventScroll: true });
}

function setReading(key, py) {
  const cell = findCell(key);
  if (!cell) return;
  const all = overrides();
  if (!py || py === cell.auto) delete all[key]; else all[key] = py;
  store.set(ovKey(state.poem), all);
  closePop();
  draw(false);
  const el = document.querySelector(`ruby.c[data-k="${key}"]`);
  if (el) el.focus({ preventScroll: true });
  toast(!py || py === cell.auto ? `已恢复「${cell.ch}」默认读音` : `「${cell.ch}」改读 ${py}，本诗会记住`);
}

function authorPop(el) {
  if (popAnchor === el) { closePop(); return; }
  closePop();
  const name = el.dataset.author, d = toDisp(name);
  openPop(`
    <h3><b class="pop-au">${esc(d)}</b></h3>
    <div class="pop-col">
      <button class="btn solid" type="button" data-author-more="${esc(name)}">更多 ${esc(d)} 的诗</button>
      <button class="btn ghost" type="button" data-author-rand="${esc(name)}">随机一首 ${esc(d)} 的诗</button>
    </div>
  `, el, { cls: "pop-author" });
}

function feihuaPop(anchor) {
  if (popAnchor === anchor) { closePop(); return; }
  closePop();
  const last = store.get("fh", "");
  const pop = openPop(`
    <h3><span>飞花令 · 出一个字，找一首含它的诗</span></h3>
    <form class="pop-row" data-fh>
      <input class="fh-input" type="text" maxlength="2" value="${esc(last)}" aria-label="飞花令用字" autocomplete="off">
      <button class="btn zhu" type="submit">寻诗</button>
    </form>
    <div class="fh-sugg">${"春花月风山水云雪酒秋".split("").map((c) => `<button type="button" data-fh-ch="${c}">${c}</button>`).join("")}</div>
  `, anchor, { sheetOnMobile: true, cls: "pop-fh" });
  const inp = pop.querySelector("input");
  inp.focus(); inp.select();
}

function settingsPop(anchor) {
  if (popAnchor === anchor) { closePop(); return; }
  closePop();
  const n = Object.keys(overrides()).length;
  const cur = fonts.current();
  const segBtn = (attr, v, label, on, title = "") => `<button type="button" role="radio" ${attr}="${v}" aria-checked="${on}"${title ? ` title="${esc(title)}" aria-label="${esc(title)}"` : ""}>${label}</button>`;
  openPop(`
    <h3><span>设置</span></h3>
    <div class="set">
      <div class="set-row">
        <b>字体</b>
        <div class="font-grid" role="radiogroup" aria-label="诗文字体">
          ${Object.entries(fonts.FONTS).map(([k, f]) => `<button type="button" role="radio" data-font="${k}" aria-checked="${k === cur}" title="${esc(f.note)}" aria-label="${esc(f.name + "（" + f.note + "）")}"><span class="fn">${esc(f.name)}</span><span class="fs">${esc(f.note)}</span></button>`).join("")}
        </div>
        <small>诗文所用字体，导出图片和打印也用它；只下载选中的那一种</small>
      </div>
      <div class="set-row">
        <b>纸面</b>
        <div class="theme-grid" role="radiogroup" aria-label="纸面主题">
          ${Object.entries(themes.THEMES).map(([k, t]) => `<button type="button" role="radio" data-theme-k="${k}" aria-checked="${k === themes.current()}" aria-label="${esc(t.name)}">${esc(t.name)}</button>`).join("")}
        </div>
        <div class="theme-custom" id="themeCustom" ${themes.current() === "custom" ? "" : "hidden"}>
          <span>遮罩</span><input type="range" min="0.1" max="0.9" step="0.05" value="${themes.veil()}" data-bg-veil aria-label="背景遮罩浓淡">
          <button class="btn text" type="button" data-bg-pick>换图</button><button class="btn text" type="button" data-bg-remove>移除</button>
        </div>
        <input type="file" accept="image/*" id="bgFile" hidden>
        <small>自定义背景的图片只存在这台设备的浏览器里，不会上传</small>
      </div>
      ${Object.entries({ size: "字号", py: "拼音", lh: "行距" }).map(([k, label]) => `<div class="set-row">
        <b>${label}</b>
        <div class="seg seg-sm" role="radiogroup" aria-label="${label}">
          ${Object.entries(DISPLAY[k]).map(([v, [name]]) => segBtn(`data-disp-${k}`, v, name, state.display[k] === v)).join("")}
        </div>
      </div>`).join("")}
      <div class="set-row">
        <b>简繁</b>
        <div class="seg seg-sm" role="radiogroup" aria-label="简体或繁体">
          ${Object.entries(LANGS).map(([k, [name]]) => segBtn("data-lang", k, name, state.lang === k)).join("")}
        </div>
      </div>
      <div class="set-row">
        <b>竖排方向</b>
        <div class="seg seg-sm" role="radiogroup" aria-label="竖排方向">
          ${segBtn("data-vdir", "rl", "从右到左", state.view.vdir === "rl")}${segBtn("data-vdir", "lr", "从左到右", state.view.vdir === "lr")}
        </div>
        <small>竖排时生效；在横排、田字格下点它会切到竖排</small>
      </div>
      <button class="btn text set-reset" type="button" data-reset-display>恢复默认</button>
      <p class="set-sub">读音</p>
      <label><b>课本读音修正</b><input type="checkbox" data-set="textbook" ${state.settings.textbook ? "checked" : ""}><small>按统编版课本通行读音，如 朝 zhāo、还 huán</small></label>
      <label><b>吟诵旧读</b><input type="checkbox" data-set="recite" ${state.settings.recite ? "checked" : ""}><small>叶音、旧读，如 斜 xiá、衰 cuī；课本已不采用</small></label>
      ${n ? `<button class="btn text" type="button" data-clear-ov>清除本诗的 ${n} 处自定义读音</button>` : ""}
    </div>
  `, anchor, { sheetOnMobile: true, cls: "pop-set" });
  fonts.loadPreviews();
}

function setFont(k) {
  fonts.choose(k);
  document.querySelectorAll("#pop [data-font]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.font === k)));
  if (state.poem) fit($("poemView"), state.view.mode);
  fonts.ready(state.poem ? state.poem.title + state.poem.lines.join("") : "").then(() => state.poem && fit($("poemView"), state.view.mode));
}
function syncDisplayButtons() {
  ["size", "py", "lh"].forEach((k) => document.querySelectorAll(`#pop [data-disp-${k}]`).forEach((b) =>
    b.setAttribute("aria-checked", String(b.getAttribute("data-disp-" + k) === state.display[k]))));
  document.querySelectorAll("#pop [data-vdir]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.vdir === state.view.vdir)));
  document.querySelectorAll("#pop [data-font]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.font === fonts.current())));
}
const DISP_LABEL = { size: "字号", py: "拼音", lh: "行距" };
function setDisplay(k, v) {
  if (!DISPLAY[k] || !DISPLAY[k][v]) return;
  state.display[k] = v; store.set("display", state.display);
  syncDisplayButtons();
  if (state.poem) { applyDisplay(); fit($("poemView"), state.view.mode); }
  previewBehindSheet();
  toast(`${DISP_LABEL[k]}：${DISPLAY[k][v][0]}`, 1200);
}
// 手机上设置是底部面板，会挡住诗文：改完把诗笺滚到面板上方，让人看得到变化
function previewBehindSheet() {
  const pop = $("pop");
  if (pop.hidden || !pop.classList.contains("as-sheet")) return;
  const body = document.querySelector("#poemView .poem-body");
  if (!body) return;
  const free = pop.getBoundingClientRect().top;
  const r = body.getBoundingClientRect();
  const want = Math.max(8, Math.min(free - Math.min(r.height, free - 16) - 8, 60));
  window.scrollBy({ top: r.top - want, behavior: "smooth" });
}
function resetDisplay() {
  state.display = { ...DISPLAY_DEFAULT }; store.del("display");
  state.view.vdir = "rl"; store.del("vdir");
  if (fonts.current() !== fonts.DEFAULT) setFont(fonts.DEFAULT);
  syncDisplayButtons();
  draw(false);
  toast("已恢复默认字体与大小");
}
function setVdir(d) {
  state.view.vdir = d === "lr" ? "lr" : "rl"; store.set("vdir", state.view.vdir);
  document.querySelectorAll("#pop [data-vdir]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.vdir === state.view.vdir)));
  const label = state.view.vdir === "lr" ? "从左到右" : "从右到左";
  if (state.view.mode !== "v") { state.view.mode = "v"; store.set("mode", "v"); toast(`已切到竖排 · ${label}`, 1600); }
  else toast(`竖排${label}`, 1200);
  draw(false);
  previewBehindSheet();
}

async function setTheme(k) {
  const ok = await themes.choose(k);
  if (!ok && k === "custom") { $("bgFile").click(); return; }
  syncThemeButtons();
  toast(`纸面：${themes.THEMES[k].name}`, 1200);
}
function syncThemeButtons() {
  const cur = themes.current();
  document.querySelectorAll("#pop [data-theme-k]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.themeK === cur)));
  const c = document.getElementById("themeCustom"); if (c) c.hidden = cur !== "custom";
}

async function setLang(l) {
  if (!LANGS[l]) return;
  if (l === "hant" && !zh.ready()) {
    toast("正在载入繁体字表…", 1600);
    try { await zh.load(); } catch (e) { toast("繁体字表没有载入，请检查网络"); return; }
  }
  state.lang = l; store.set("lang", l);
  api.setLang(LANGS[l][1]);
  document.documentElement.lang = LANGS[l][1];
  document.querySelectorAll("#pop [data-lang]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lang === l)));
  if (state.poem) draw(false);
  if (!$("sheet").hidden) renderResults();
  previewBehindSheet();
  toast(l === "hant" ? "已切换为繁体" : "已切换为简体", 1200);
}

/* ---------------- 筛选抽屉 ---------------- */
let metaLoaded = false;
function renderChips(el, list, isOn, attr) {
  el.innerHTML = list.map((n) => `<button class="chip" type="button" ${attr}="${esc(n)}" aria-pressed="${isOn(n)}">${esc(n)}</button>`).join("");
}
function drawChips(dyn, types) {
  renderChips($("chipsDyn"), dyn, (n) => state.filters.dynasty === n, "data-dyn");
  renderChips($("chipsType"), types, (n) => state.filters.types.includes(n), "data-type");
}
async function loadMeta() {
  if (metaLoaded) return;
  drawChips(FALLBACK_DYN, FALLBACK_TYPE);
  $("drawerNote").textContent = "正在取诗库里的朝代与体裁…";
  try {
    const [dyn, types] = await Promise.all([api.meta("dynasties"), api.meta("types")]);
    metaLoaded = true;
    drawChips(dyn.length ? dyn : FALLBACK_DYN, (types.length ? types : FALLBACK_TYPE).filter((t) => t !== "其他"));
    $("drawerNote").textContent = "选好后点「按条件随机一首」，顶栏的「随机」也会沿用这些条件。";
  } catch (e) {
    $("drawerNote").textContent = `${e.message}，先用常见的朝代与体裁。`;
  }
}
function toggleDrawer(force) {
  const d = $("drawer");
  const open = force !== undefined ? force : d.hidden;
  d.hidden = !open;
  $("btnFilter").setAttribute("aria-expanded", String(open));
  if (open) { $("fAuthor").value = toDisp(state.filters.author); drawPoets(); loadMeta(); }
}
function drawPoets() {
  const cur = state.filters.author;
  $("chipsPoet").innerHTML = POETS.map((n) => `<button class="chip chip-sm" type="button" data-poet="${esc(n)}" aria-pressed="${n === cur}">${esc(toDisp(n))}</button>`).join("");
  $("poetList").innerHTML = POETS.map((n) => `<option value="${esc(toDisp(n))}"></option>`).join("");
}
function setPoetFilter(v) {
  state.filters.author = toSimp(String(v || "").trim());
  saveFilters();
  $("chipsPoet").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.poet === state.filters.author)));
}
function saveFilters() { store.set("filters", state.filters); syncControls(); }

/* ---------------- 事件 ---------------- */
function bind() {
  // 顶栏搜索（桌面）：边打边查课本精选，回车搜诗库
  $("q").addEventListener("input", (e) => { const q = e.target.value.trim(); if (q) { openSheet(); liveSearch(q); } else { liveSearch(""); } });
  $("q").addEventListener("focus", (e) => { if (e.target.value.trim()) { openSheet(); liveSearch(e.target.value.trim()); } });
  $("searchForm").addEventListener("submit", (e) => { e.preventDefault(); fullSearch($("q").value); });
  $("q2").addEventListener("input", (e) => liveSearch(e.target.value.trim()));
  $("sheetForm").addEventListener("submit", (e) => { e.preventDefault(); fullSearch($("q2").value); });
  $("sheetClose").addEventListener("click", closeSheet);
  $("scrim").addEventListener("click", closeSheet);
  $("btnMore").addEventListener("click", () => fullSearch(state.search.q, state.search.page + 1));
  $("results").addEventListener("click", (e) => {
    if (e.target.closest("[data-more-author]")) { moreAuthor(); return; }
    const b = e.target.closest(".res"); if (!b) return;
    const p = $("results")._items[+b.dataset.i];
    if (p) setPoem(p, { hi: "" });
  });
  $("sheetStatus").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    if (b.dataset.act === "author") doRandom({ author: b.dataset.v });
    else doFeihua(b.dataset.v);
  });

  $("btnRandom").addEventListener("click", () => doRandom());
  $("dRandom").addEventListener("click", () => doRandom());
  $("btnFeihua").addEventListener("click", (e) => feihuaPop(e.currentTarget));
  $("dFeihua").addEventListener("click", (e) => feihuaPop(e.currentTarget));
  $("dSearch").addEventListener("click", () => { openSheet($("q2").value); liveSearch($("q2").value.trim()); });
  $("btnFilter").addEventListener("click", () => toggleDrawer());
  $("btnSettings").addEventListener("click", (e) => settingsPop(e.currentTarget));

  $("modeSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); });
  $("modeSeg").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const ks = Object.keys(MODES); const i = ks.indexOf(state.view.mode);
    const m = ks[(i + (e.key === "ArrowRight" ? 1 : ks.length - 1)) % ks.length];
    setMode(m); document.querySelector(`#modeSeg [data-mode="${m}"]`).focus();
  });
  $("dMode").addEventListener("click", () => { const ks = Object.keys(MODES); setMode(ks[(ks.indexOf(state.view.mode) + 1) % ks.length]); toast(MODES[state.view.mode], 1200); });
  $("togPinyin").addEventListener("click", () => setPinyin(!state.view.pinyin));
  $("dPinyin").addEventListener("click", () => setPinyin(!state.view.pinyin));
  $("togVeil").addEventListener("click", () => setVeil(!state.view.veil));
  $("dVeil").addEventListener("click", () => setVeil(!state.view.veil));

  // 诗笺：点字改读音 / 遮字模式点句
  $("poemView").addEventListener("click", (e) => {
    if (state.view.veil) {
      const line = e.target.closest(".line"); if (!line) return;
      const li = +line.dataset.li;
      const s = state.view.veiled; s.has(li) ? s.delete(li) : s.add(li);
      line.classList.toggle("veiled", s.has(li));
      return;
    }
    const au = e.target.closest("[data-author]"); if (au) { authorPop(au); return; }
    const c = e.target.closest("ruby.c"); if (c) charPop(c);
  });
  $("poemView").addEventListener("keydown", (e) => {
    const c = e.target.closest("ruby.c"); if (!c) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); charPop(c); return; }
    const dirs = state.view.mode === "v" ? { ArrowDown: 1, ArrowUp: -1, ArrowLeft: 1, ArrowRight: -1 } : { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 };
    if (!(e.key in dirs)) return;
    e.preventDefault();
    const all = [...$("poemView").querySelectorAll("ruby.c")];
    const next = all[all.indexOf(c) + dirs[e.key]];
    if (next) { c.tabIndex = -1; next.tabIndex = 0; next.focus(); }
  });
  ["sideAu", "sideNote"].forEach((id) => $(id).addEventListener("click", (e) => {
    const w = e.target.closest("[data-side-search]");
    if (w) { const q = toDisp(w.dataset.sideSearch); $("q").value = q; openSheet(q); fullSearch(q); return; }
    if (e.target.closest(".side-toggle")) toggleSide($(id));
  }));
  $("cardNote").addEventListener("click", (e) => {
    if (!e.target.closest("[data-alt]") || !state.alt) return;
    const { poem, from, toTextbook } = state.alt;
    setPoem(poem, { hi: state.view.hi, alt: { poem: from, from: poem, toTextbook: !toTextbook } });
  });

  // 浮层内
  $("pop").addEventListener("click", (e) => {
    const pop = $("pop");
    const opt = e.target.closest(".opt"); if (opt) { setReading(pop.dataset.k, opt.dataset.py); return; }
    if (e.target.closest("[data-reset]")) { setReading(pop.dataset.k, ""); return; }
    const fh = e.target.closest("[data-fh-ch]"); if (fh) { doFeihua(fh.dataset.fhCh); return; }
    const fo = e.target.closest("button[data-font]"); if (fo) { setFont(fo.dataset.font); return; }
    const th = e.target.closest("[data-theme-k]"); if (th) { setTheme(th.dataset.themeK); return; }
    if (e.target.closest("[data-bg-pick]")) { $("bgFile").click(); return; }
    if (e.target.closest("[data-bg-remove]")) { themes.removeCustom().then(() => { syncThemeButtons(); toast("已移除自定义背景"); }); return; }
    const vd = e.target.closest("[data-vdir]"); if (vd) { setVdir(vd.dataset.vdir); return; }
    const lg = e.target.closest("[data-lang]"); if (lg) { setLang(lg.dataset.lang); return; }
    const am = e.target.closest("[data-author-more]"); if (am) { authorSearch(am.dataset.authorMore); return; }
    const ar = e.target.closest("[data-author-rand]"); if (ar) { closePop(); doRandom({ author: ar.dataset.authorRand }); return; }
    const ds = e.target.closest("[data-disp-size],[data-disp-py],[data-disp-lh]");
    if (ds) { const k = ["size", "py", "lh"].find((x) => ds.hasAttribute("data-disp-" + x)); setDisplay(k, ds.getAttribute("data-disp-" + k)); return; }
    if (e.target.closest("[data-reset-display]")) { resetDisplay(); return; }
    if (e.target.closest("[data-clear-ov]")) { store.del(ovKey(state.poem)); closePop(); draw(false); toast("已清除本诗的自定义读音"); }
  });
  $("pop").addEventListener("input", (e) => { if (e.target.matches("[data-bg-veil]")) themes.setVeil(+e.target.value); });
  $("pop").addEventListener("change", async (e) => {
    if (e.target.id === "bgFile") {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      try { await themes.setCustom(f); syncThemeButtons(); toast("已换上自定义背景（只存在本机）"); } catch (err) { toast(err.message || "图片没能用上"); }
      return;
    }
    const k = e.target.dataset.set; if (!k) return;
    state.settings[k] = e.target.checked; store.set("settings", state.settings); draw(false);
  });
  $("pop").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.matches("[data-fh]")) { doFeihua(f.querySelector("input").value); return; }
    if (f.matches("[data-custom]")) {
      const py = normalizePinyin(f.querySelector("input").value);
      if (!py) { toast("没看懂这个拼音，试试 xia2 或 xiá"); return; }
      setReading($("pop").dataset.k, py);
    }
  });

  // 抽屉
  $("drawer").addEventListener("click", (e) => {
    const d = e.target.closest("[data-dyn]");
    if (d) { state.filters.dynasty = state.filters.dynasty === d.dataset.dyn ? "" : d.dataset.dyn; saveFilters();
      $("chipsDyn").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.dyn === state.filters.dynasty))); return; }
    const po = e.target.closest("[data-poet]");
    if (po) { const n = state.filters.author === po.dataset.poet ? "" : po.dataset.poet; $("fAuthor").value = toDisp(n); setPoetFilter(n); return; }
    const t = e.target.closest("[data-type]");
    if (t) { const s = new Set(state.filters.types); s.has(t.dataset.type) ? s.delete(t.dataset.type) : s.add(t.dataset.type); state.filters.types = [...s]; saveFilters();
      t.setAttribute("aria-pressed", String(s.has(t.dataset.type))); return; }
  });
  $("fAuthor").addEventListener("input", (e) => setPoetFilter(e.target.value));
  $("fAuthor").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("btnFilterGo").click(); } });
  $("btnFilterGo").addEventListener("click", () => { setPoetFilter($("fAuthor").value); toggleDrawer(false); doRandom(); });
  $("btnPoetList").addEventListener("click", () => { const n = toSimp($("fAuthor").value.trim()); if (n) { toggleDrawer(false); authorSearch(n); } else { toast("先填一位诗人"); $("fAuthor").focus(); } });
  $("btnFilterClear").addEventListener("click", () => { state.filters = { dynasty: "", types: [], author: "" }; $("fAuthor").value = ""; saveFilters(); drawPoets();
    document.querySelectorAll("#drawer .chip").forEach((c) => c.setAttribute("aria-pressed", "false")); });

  // 导出
  $("btnPrint").addEventListener("click", async () => {
    const d = state.disp || state.poem;
    if (d) await fonts.ready(d.title + d.lines.join(""));
    window.print();
  });
  $("btnCopy").addEventListener("click", async () => {
    if (!state.ann) return;
    toast((await copyText(poemToText(state.disp || state.poem, state.ann))) ? "已复制带拼音的文本" : "复制失败，请手动选择");
  });
  $("btnImage").addEventListener("click", async () => {
    if (!state.poem) return;
    toast("正在研墨…", 1200);
    try {
      const d = state.disp || state.poem;
      await fonts.ready(d.title + d.lines.join("") + (d.author || "") + (d.dynasty || ""));
      const blob = await cardToPNG($("poem"), await themes.bgImage().catch(() => null));
      download(blob, `吟诗-${baseTitle((state.disp || state.poem).title) || "古诗"}.png`);
      toast("图片已导出");
    } catch (e) { console.warn(e); toast("导出失败，可以先用打印"); }
  });

  // 键盘
  document.addEventListener("keydown", (e) => {
    const typing = e.target.matches("input, textarea, [contenteditable]");
    if (e.key === "Escape") {
      if (!$("pop").hidden) { const a = popAnchor; closePop(); if (a) a.focus(); return; }
      if (!$("sheet").hidden) { closeSheet(); $("q").blur(); return; }
      if (!$("drawer").hidden) { toggleDrawer(false); return; }
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); if (isMobile()) openSheet($("q2").value); else $("q").focus(); }
    else if (e.key === "r" || e.key === "R") doRandom();
  });
  document.addEventListener("click", (e) => {
    if ($("pop").hidden) return;
    if (e.target.closest("#pop") || (popAnchor && popAnchor.contains(e.target))) return;
    closePop();
  });
  let rz;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if (state.poem) fit($("poemView"), state.view.mode); closePop(); }, 120); });
  if (document.fonts) document.fonts.ready.then(() => state.poem && fit($("poemView"), state.view.mode));
}

/* ---------------- 启动：不请求 API ---------------- */
async function boot() {
  bind();
  syncControls();
  if (state.lang === "hant") {
    document.documentElement.lang = "zh-Hant";
    try { await zh.load(); } catch (e) { state.lang = "hans"; api.setLang("zh-Hans"); console.warn(e); }
  }
  try {
    const [daily, fixes] = await Promise.all([
      fetch("poem/daily-poems.json" + VQ).then((r) => r.json()),
      fetch("poem/poem-readings.json" + VQ).then((r) => r.json()),
    ]);
    DAILY = daily.poems || [];
    loadFixes(fixes);
  } catch (e) {
    $("poemView").innerHTML = `<p class="res-empty">诗文数据没有载入。请通过网站地址或本地服务器打开（例如 <code>npx serve site</code>），不要直接双击 index.html。</p>`;
    console.error(e);
    return;
  }
  if (!window.pinyinPro) { $("poemView").innerHTML = `<p class="res-empty">拼音引擎没有载入。</p>`; return; }
  setPoem(dailyPoem(todayIndex()), { focus: false });
}
fonts.apply();
themes.apply();
boot();
