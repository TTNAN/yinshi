// 吟诗 · 主程序
import * as store from "./store.js";
import * as api from "./api.js";
import { loadFixes, annotate, optionsFor, normalizePinyin, HAN } from "./reading.js";
import { renderPoem, fit } from "./render.js";
import { cardToPNG, download, poemToText, copyText } from "./exporter.js";
import * as fonts from "./fonts.js";
import * as zh from "./zh.js";
import * as themes from "./themes.js";
import * as study from "./study.js";
import * as lists from "./lists.js";

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
// 有足迹地图的诗人（与 map.js、data/footprints.json 一致）
const FOOT_POETS = ["李白", "杜甫", "苏轼", "白居易", "王维", "陆游", "辛弃疾", "李清照"];
const LANGS = { hans: ["简体", "zh-Hans"], hant: ["繁體", "zh-Hant"] };
const FALLBACK_TYPE = Object.keys(api.TYPES);   // 诗 / 词 / 曲

let DAILY = [];
const VQ = (() => { const v = new URL(import.meta.url).searchParams.get("v"); return v ? "?v=" + v : ""; })();
const state = {
  poem: null, alt: null,
  view: { mode: store.get("mode", "h"), vdir: store.get("vdir", "rl") === "lr" ? "lr" : "rl", pinyin: store.get("pinyin", true), veil: false, veiled: new Set(), today: false, tag: "", hi: "" },
  settings: Object.assign({ textbook: true, recite: false, pingze: false }, store.get("settings", {})),
  display: Object.assign({}, DISPLAY_DEFAULT, store.get("display", {})),
  filters: Object.assign({ dynasty: "", types: [], author: "" }, store.get("filters", {})),
  ann: null,
  search: { q: "", page: 1, local: [], remote: [], author: null },
  lang: store.get("lang", "hans") === "hant" ? "hant" : "hans",
  dict: null,           // 默写：{ blanks, answers }
  rate: Math.min(1.5, Math.max(0.5, +store.get("rate", 0.9) || 0.9)),
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
let CATALOG = null;
let NOTES = null, POET_INFO = null, NOTES_BY_FIRST = new Map(), sideLoading = null;
function loadSide() {
  if (!sideLoading) {
    sideLoading = Promise.all([
      fetch("data/poets.json" + VQ).then((r) => r.json()),
      fetch("data/notes.json" + VQ).then((r) => r.json()),
      CATALOG ? Promise.resolve(CATALOG) : fetch("data/catalog.json" + VQ).then((r) => r.json()),
    ]).then(([p, n, c]) => {
      CATALOG = c;
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
  const first = !NOTES;
  try { await loadSide(); } catch { au.hidden = no.hidden = true; return; }
  if (seq !== sideSeq) return;
  if (first && (noteFor(p) || {}).ci) { draw(false); return; }     // 注释词要在诗笺上画虚线：数据到了重画一次
  const s = view(p).simp;
  const D = (x) => esc(toDisp(x || ""));
  const poet = POET_INFO[s.author];
  let auHTML = "";
  if (poet) {
    const meta = [poet.d, poet.y].filter(Boolean).join(" · ");
    const foot = FOOT_POETS.includes(s.author) ? `<button type="button" class="au-foot" data-foot="${esc(s.author)}" title="看${D(s.author)}的足迹地图">足迹</button>` : "";
    auHTML = `<p class="au-name">${D(s.author)}${foot}</p><p class="au-meta">${D(meta)}${poet.zi ? "<br>" + D(poet.zi) : ""}</p><p>${D(poet.bio)}</p>`
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
  const rel = study.related(s, DAILY, CATALOG);
  const relHTML = rel.length ? `<h4>相关的诗</h4><div class="rel">${rel.map((r) => `<button type="button" data-rel="${r.i}"><b>${D(r.d.t)}</b><small>${D(r.d.a)}${r.why ? " · " + D(r.why) : ""}</small></button>`).join("")}</div>` : "";
  if (n) {
    $("sideNoteBody").innerHTML = [n.yi && `<h4>诗意</h4><p>${D(n.yi)}</p>`, n.qing && `<h4>情感</h4><p>${D(n.qing)}</p>`, n.bei && `<h4>创作背景</h4><p>${D(n.bei)}</p>`].filter(Boolean).join("") + relHTML;
    no.hidden = false; no.classList.remove("empty");
  } else {
    $("sideNoteBody").innerHTML = `<p class="muted">暂无赏析</p>` + relHTML;
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
  study.stopSpeak(); setSpeakingUI(false);
  state.dict = null;
  state.poem = p;
  state.view.hi = opts.hi || "";
  state.view.today = p.source === "daily" && p.dailyIndex === todayIndex();
  state.view.tag = opts.tag || (p.source === "daily" ? "小学必背" : (p.type && p.type !== "其他" ? p.type : "诗库"));
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
  const pz = state.settings.pingze && study.isJinti(simp.lines);
  state.ann = {
    title: glyphs(annotate([splitTitle(simp.title).main], { ...o, prefix: "t", hi: "" }), [splitTitle(disp.title).main]),
    lines: glyphs(study.decorate(annotate(simp.lines, o), simp.lines, { note: noteFor(p), pingze: pz, dictation: state.dict }), disp.lines),
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
  drawTip(pz);
  syncStudy();
  drawSide();
  document.dispatchEvent(new CustomEvent("yinshi:drawn"));
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
  if (on && state.dict) state.dict = null;
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
  return `<li class="res-li"><button class="res" type="button" data-i="${i}">
      <span class="res-t">${hl(d.title || "（无题）", q)}${badge ? `<span class="res-badge">${badge}</span>` : ""}</span>
      <span class="res-m">${esc(d.author)}${d.dynasty ? " · " + esc(d.dynasty) : ""}</span>
      <span class="res-l">${hl(firstLineWith(d, q), q)}</span>
    </button><button class="res-add" type="button" data-add-i="${i}" title="加入学习列表" aria-label="把《${esc(d.title)}》加入学习列表">＋</button></li>`;
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
  if (cell.blank) { dictPop(el, cell); return; }
  if (popAnchor === el) { closePop(); return; }
  closePop();
  el.classList.add("on");
  const opts = optionsFor(cell);
  const setName = { textbook: "课本读音修正", recite: "吟诵旧读" };
  const note = cell.ov ? `已自定义（默认 ${esc(cell.auto)}），本诗会记住。`
    : cell.fix ? `${setName[cell.fix.set]}：${esc(cell.fix.note)}`
    : opts.length > 1 ? "多音字，按上下文自动选了一个读音。" : "";
  const gloss = el.dataset.ci && noteFor(state.poem) && noteFor(state.poem).ci[el.dataset.ci];
  const pop = openPop(`
    ${gloss ? `<div class="gloss"><b>${esc(toDisp(el.dataset.ci))}</b><span>${esc(toDisp(gloss))}</span></div>` : ""}
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
      <label><b>平仄标注</b><input type="checkbox" data-set="pingze" ${state.settings.pingze ? "checked" : ""}><small>参考：只标五七言绝句、律诗；按普通话声调，常见入声字算仄</small></label>
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
  if (!$("browse").hidden) renderBrowse();
  if (MAP && MAP.isOpen()) MAP.refresh();
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
    const ad = e.target.closest("[data-add-i]"); if (ad) { const p = $("results")._items[+ad.dataset.addI]; if (p) addListPop(ad, view(p).simp); return; }
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
    const ft = e.target.closest("[data-foot]"); if (ft) { openMap({ poet: ft.dataset.foot }); return; }
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
  $("btnPrint").addEventListener("click", (e) => printPop(e.currentTarget));
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
      const blob = await cardToPNG($("poem"), await themes.bgImage().catch(() => null), exportExtras());
      download(blob, `吟诗-${baseTitle((state.disp || state.poem).title) || "古诗"}.png`);
      toast("图片已导出");
    } catch (e) { console.warn(e); toast("导出失败，可以先用打印"); }
  });

  // 键盘
  document.addEventListener("keydown", (e) => {
    const typing = e.target.matches("input, textarea, [contenteditable]");
    if (e.key === "Escape") {
      if (MODAL && !MODAL.hidden) { closeModal(); return; }
      if (MAP && MAP.isOpen()) { MAP.close(); return; }
      if (!$("pop").hidden) { const a = popAnchor; closePop(); if (a) a.focus(); return; }
      if (!$("sheet").hidden) { closeSheet(); $("q").blur(); return; }
      if (!$("browse").hidden) { closeBrowse(); return; }
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

/* ---------------- 学习：朗读 · 默写 · 收藏 · 背诵打卡 · 平仄提示 ---------------- */
const pkey = (p) => { const s = view(p).simp; return baseTitle(s.title) + "|" + s.author; };
function drawTip(pz) {
  const tip = $("cardTip");
  const parts = [];
  if (state.settings.pingze) {
    parts.push(pz ? `<span class="pz-legend"><i class="pz pz-p">—</i>平 <i class="pz pz-z">|</i>仄 <i class="pz pz-r">|</i>入声（按仄）<small>参考</small></span>`
      : `<span class="muted">平仄只标五七言绝句、律诗</span>`);
  }
  if (state.dict) {
    const total = state.dict.blanks.size, done = Object.keys(state.dict.answers).length;
    const ok = Object.entries(state.dict.answers).filter(([k, v]) => (findCell(k) || {}).ch === v).length;
    parts.push(done < total ? `<span>默写：点空格填字（${done} / ${total}）</span><button class="btn text" type="button" data-dict-end>结束默写</button>`
      : `<span class="dict-score">默写完成：答对 <b>${ok}</b> / ${total}</span><button class="btn ghost" type="button" data-dict-again>再来一次</button><button class="btn text" type="button" data-dict-end>看原诗</button>`);
  }
  tip.innerHTML = parts.join("");
  tip.hidden = !parts.length;
}
function syncStudy() {
  const p = state.poem; if (!p) return;
  const k = pkey(p);
  const fav = !!study.favs()[k];
  $("btnFav").setAttribute("aria-pressed", String(fav));
  $("btnFav").querySelector("span").textContent = fav ? "已收藏" : "收藏";
  const rs = study.reciteState(k);
  const rb = $("btnRecited");
  rb.dataset.state = rs.state;
  rb.setAttribute("aria-pressed", String(rs.state !== "new"));
  rb.querySelector("span").textContent = { new: "背会了", due: "复习打卡", wait: `已背 · ${rs.r ? rs.r.next.slice(5).replace("-", "/") : ""} 复习`, done: "已掌握" }[rs.state];
  $("btnDictate").setAttribute("aria-pressed", String(!!state.dict));
  drawDue();
}
function drawDue() {
  const due = study.dueList();
  const chip = $("dueChip");
  chip.hidden = !due.length;
  chip.textContent = `今天有 ${due.length} 首诗该复习了`;
}
function toggleDictation() {
  if (!state.poem) return;
  closePop();
  if (state.dict) { state.dict = null; draw(false); return; }
  if (state.view.veil) { state.view.veil = false; state.view.veiled = new Set(); }
  state.dict = study.makeDictation(state.ann.lines);
  draw(false);
  toast("点空格填字，可以选也可以自己写", 2200);
}
function dictPop(el, cell) {
  if (popAnchor === el) { closePop(); return; }
  closePop();
  el.classList.add("on");
  const pool = DAILY.map((d) => d.lines.join("")).join("") + state.poem.lines.join("");
  const ch = study.choicesFor(cell.ch, view({ ...state.poem, lines: [pool], title: "", author: "", dynasty: "", type: "" }).disp.lines[0]);
  const disp = (x) => toDisp(x);
  const pop = openPop(`
    <h3><span>这里是什么字？</span><small class="py">${esc(cell.py)}</small></h3>
    <div class="opts dict-opts">${ch.map((c) => `<button class="dopt" type="button" data-dict-pick="${esc(c)}">${esc(disp(c))}</button>`).join("")}</div>
    <form class="pop-row" data-dict-type><input type="text" maxlength="2" placeholder="自己写" aria-label="自己写这个字" autocomplete="off"><button class="btn solid" type="submit">填</button></form>
  `, el, { cls: "pop-char" });
  pop.dataset.k = cell.key;
}
function dictAnswer(key, ch) {
  if (!state.dict) return;
  const c = Array.from(toSimp(ch || "")).find((x) => HAN.test(x));
  if (!c) { toast("请写一个汉字"); return; }
  state.dict.answers[key] = c;
  closePop(); draw(false);
  const total = state.dict.blanks.size, done = Object.keys(state.dict.answers).length;
  if (done >= total) {
    const ok = Object.entries(state.dict.answers).filter(([k, v]) => (findCell(k) || {}).ch === v).length;
    toast(ok === total ? `全对！${ok} / ${total}` : `答对 ${ok} / ${total}，红色的是写错的`, 2600);
  }
}
let speakingNow = false;
function setSpeakingUI(on) {
  speakingNow = on;
  const b = $("btnRead"); if (!b) return;
  b.setAttribute("aria-pressed", String(on));
  b.querySelector("span").textContent = on ? "停止" : "朗读";
  if (!on) document.querySelectorAll("#poemView ruby.say").forEach((r) => r.classList.remove("say"));
}
function speakCells(li, ci) {
  document.querySelectorAll("#poemView ruby.say").forEach((r) => r.classList.remove("say"));
  if (li < 0) return;
  const el = document.querySelector(`#poemView ruby.c[data-k="${li}:${ci}"]`);
  if (el) el.classList.add("say");
}
function readPop(anchor) {
  if (speakingNow) { study.stopSpeak(); setSpeakingUI(false); closePop(); return; }
  if (popAnchor === anchor) { closePop(); return; }
  closePop();
  const s = view(state.poem).simp, d = state.disp || state.poem;
  openPop(`
    <h3><span>朗读</span><small>${esc(study.voiceName())}</small></h3>
    <div class="read-row"><button class="btn solid" type="button" data-read-all>▶ 整首</button>
      <label class="read-loop"><input type="checkbox" data-read-loop ${store.get("readLoop", false) ? "checked" : ""}> 单句循环</label></div>
    <ol class="read-lines">${d.lines.map((l, i) => `<li><button type="button" data-read-line="${i}">▶ ${esc(l)}</button></li>`).join("")}</ol>
    <label class="read-rate"><span>语速</span><input type="range" min="0.5" max="1.5" step="0.1" value="${state.rate}" data-read-rate aria-label="语速"><b id="rateVal">${state.rate.toFixed(1)}</b></label>
  `, anchor, { sheetOnMobile: true, cls: "pop-read" });
  void s;
}
function speak(which) {
  const s = view(state.poem).simp;
  const lines = which === "all" ? s.lines.map((t, li) => ({ text: t, li })) : [{ text: s.lines[which], li: which }];
  if (which === "all") lines.unshift({ text: `${s.title}，${s.dynasty ? s.dynasty + "，" : ""}${s.author}。`, li: -9 });
  const loop = which !== "all" && store.get("readLoop", false);
  setSpeakingUI(true);
  if (isMobile()) closePop();
  study.speakLines(lines, { rate: state.rate, loop, onChar: (li, ci) => (li === -9 ? speakCells(-1) : speakCells(li, ci)), onEnd: () => setSpeakingUI(false) });
}

/* ---------------- 打印 / 导出选项 ---------------- */
const PRINT_DEFAULT = { py: true, yi: false, ci: false, shang: false, big: false };
const printOpts = () => Object.assign({}, PRINT_DEFAULT, store.get("printOpts", {}));
function printPop(anchor) {
  if (popAnchor === anchor) { closePop(); return; }
  closePop();
  const o = printOpts(), n = noteFor(state.poem);
  const box = (k, label, dis) => `<label class="pchk${dis ? " dis" : ""}"><input type="checkbox" data-popt="${k}" ${o[k] && !dis ? "checked" : ""} ${dis ? "disabled" : ""}> ${label}</label>`;
  openPop(`
    <h3><span>打印 / 导出</span></h3>
    <div class="pchks">${box("py", "拼音")}${box("big", "大字")}${box("yi", "译文", !(n && n.yi))}${box("ci", "注释", !(n && n.ci))}${box("shang", "赏析", !(n && (n.qing || n.bei)))}</div>
    <p class="pop-note">译文、注释、赏析只有收录了赏析的诗才有。大字只用于打印。</p>
    <div class="pop-row"><button class="btn solid" type="button" data-do-print>打印</button><button class="btn ghost" type="button" data-do-export>导出图片</button></div>
  `, anchor, { sheetOnMobile: true, cls: "pop-print" });
}
function extraBlocks() {
  const o = printOpts(), n = noteFor(state.poem);
  if (!n) return [];
  const out = [];
  if (o.yi && n.yi) out.push({ h: "译文", t: toDisp(n.yi) });
  if (o.ci && n.ci) out.push({ h: "注释", t: Object.entries(n.ci).map(([w, m]) => `${toDisp(w)}：${toDisp(m)}`).join("；") });
  if (o.shang && (n.qing || n.bei)) out.push({ h: "赏析", t: [n.qing, n.bei].filter(Boolean).map(toDisp).join("") });
  return out;
}
function exportExtras() { return extraBlocks(); }
async function doPrint() {
  closePop();
  const o = printOpts();
  const box = $("printExtra");
  box.innerHTML = extraBlocks().map((b) => `<h4>${esc(b.h)}</h4><p>${esc(b.t)}</p>`).join("");
  document.body.classList.toggle("print-nopy", !o.py);
  document.body.classList.toggle("print-big", !!o.big);
  const d = state.disp || state.poem;
  if (d) await fonts.ready(d.title + d.lines.join("") + box.textContent);
  window.print();
}

/* ---------------- 分类找诗 · 我的诗单 · 诗词接龙 ---------------- */
let browseTab = "cat", browseSel = "";
async function openBrowse(tab) {
  if (tab) browseTab = tab;
  closePop(); closeSheet();
  $("browse").hidden = false; $("scrim").hidden = false; document.body.classList.add("sheet-open");
  try { await loadSide(); } catch { /* 分类数据没载入时只显示诗单 */ }
  renderBrowse();
}
function closeBrowse() {
  $("browse").hidden = true;
  if ($("sheet").hidden) { $("scrim").hidden = true; document.body.classList.remove("sheet-open"); }
}
function poemBtn(p, i, extra = "") {
  const d = view(p).disp;
  return `<li><button class="res" type="button" data-bp="${i}"><span class="res-t">${esc(d.title)}${extra}</span><span class="res-m">${esc(d.author)}${d.dynasty ? " · " + esc(d.dynasty) : ""}</span><span class="res-l">${esc(d.lines[0] || "")}</span></button></li>`;
}
let browseItems = [];
function renderBrowse() {
  document.querySelectorAll("#browse [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === browseTab)));
  const body = $("browseBody");
  browseItems = [];
  const keyIndex = new Map(DAILY.map((d, i) => [d.t + "|" + d.a, i]));
  if (browseTab === "cat") {
    const C = CATALOG || { grades: {}, themes: {} };
    const chips = (obj, kind) => Object.keys(obj).map((g) => `<button class="chip" type="button" data-bsel="${kind}:${esc(g)}" aria-pressed="${browseSel === kind + ":" + g}">${esc(toDisp(g))}</button>`).join("");
    let list = "";
    if (browseSel) {
      const [kind, g] = browseSel.split(/:(.*)/);
      const keys = ((kind === "g" ? C.grades : C.themes)[g] || []);
      list = `<ol class="results">${keys.map((k) => keyIndex.get(k)).filter((i) => i != null).map((i) => { browseItems.push(dailyPoem(i)); return poemBtn(browseItems[browseItems.length - 1], browseItems.length - 1); }).join("")}</ol>`;
    }
    const foot = `<p class="b-h">诗人足迹 <small>在山河图上看诗人走过的地方、在哪里写了哪首诗</small></p><div class="chips"><button class="chip" type="button" data-map="">${esc(toDisp("总览"))}</button>${FOOT_POETS.map((n) => `<button class="chip" type="button" data-map="${esc(n)}">${esc(toDisp(n))}</button>`).join("")}</div>`;
    body.innerHTML = foot + `<p class="b-h">按年级 <small>统编版小学课本，只收较确定的篇目</small></p><div class="chips">${chips(C.grades, "g")}</div>
      <p class="b-h">按主题</p><div class="chips">${chips(C.themes, "t")}</div>${list}`;
  } else if (browseTab === "mine") {
    renderMine(body);
  } else {
    renderJielong(body);
  }
}
// 诗词接龙：下一句要以上一句的最后一个字开头
let JL = null;
async function jlPool() {
  if (JL && JL.pool) return JL.pool;
  let featured = [];
  try { featured = await api.featuredPoems(); } catch { /* 只用课本诗 */ }
  return study.clausesOf(DAILY.map((d) => ({ title: d.t, author: d.a, lines: d.lines })).concat(featured));
}
async function jlNext(fromText) {
  const ch = study.lastHan(fromText);
  const used = JL.used;
  let cands = JL.pool.filter((c) => Array.from(c.text)[0] === ch && !used.has(c.text));
  if (!cands.length) {
    // 本地没有：去备用诗库按字随机找一首，取以这个字开头的一句
    for (let i = 0; i < 2 && !cands.length; i++) {
      try {
        const p = await api.random({ char: ch });
        if (p) cands = study.clausesOf([view(p).simp]).filter((c) => Array.from(c.text)[0] === ch && !used.has(c.text));
      } catch { break; }
    }
  }
  return { ch, cands };
}
async function jlRound() {
  const { ch, cands } = await jlNext(JL.cur.text);
  if (!cands.length) { JL.end = `没有找到以「${toDisp(ch)}」开头的诗句，接龙到这里结束`; renderBrowse(); return; }
  const right = cands[Math.floor(Math.random() * cands.length)];
  const wrong = JL.pool.filter((c) => Array.from(c.text)[0] !== ch).sort(() => Math.random() - 0.5).slice(0, 2);
  JL.q = { ch, opts: [right, ...wrong].sort(() => Math.random() - 0.5), right };
  renderBrowse();
}
async function jlStart() {
  const pool = await jlPool();
  const start = pool[Math.floor(Math.random() * Math.min(pool.length, 400))];
  JL = { pool, used: new Set([start.text]), cur: start, chain: [start], score: 0, q: null, end: "" };
  await jlRound();
}
function renderJielong(body) {
  if (!JL) {
    body.innerHTML = `<p class="b-h">诗词接龙 <small>下一句要以上一句的最后一个字开头</small></p><p class="b-intro">电脑先出一句，你从三句里挑出能接上的那一句。课本诗和唐诗三百首里找不到时，会去诗库再找。</p><button class="btn solid" type="button" data-jl-start>开始接龙</button>`;
    return;
  }
  const chain = JL.chain.map((c) => `<li><b>${esc(toDisp(c.text))}</b><small>${esc(toDisp(c.author))}《${esc(toDisp(c.title))}》</small></li>`).join("");
  const q = JL.q && !JL.end ? `<p class="b-h">接「<b class="zhu">${esc(toDisp(JL.q.ch))}</b>」字开头的诗句</p><div class="jl-opts">${JL.q.opts.map((o, i) => `<button class="btn ghost" type="button" data-jl-pick="${i}">${esc(toDisp(o.text))}</button>`).join("")}</div>` : "";
  body.innerHTML = `<p class="b-h">诗词接龙 <small>接上 ${JL.score} 句</small></p><ol class="jl-chain">${chain}</ol>${q}
    ${JL.end ? `<p class="b-intro">${esc(JL.end)}</p>` : ""}<div class="pop-row"><button class="btn text" type="button" data-jl-start>${JL.end ? "再玩一局" : "重新开始"}</button></div>`;
  const ol = body.querySelector(".jl-chain"); if (ol) ol.scrollTop = ol.scrollHeight;
}
async function jlPick(i) {
  if (!JL || !JL.q) return;
  const o = JL.q.opts[i];
  if (Array.from(o.text)[0] === JL.q.ch) {
    JL.score++; JL.used.add(o.text); JL.chain.push(o); JL.cur = o; JL.q = null;
    renderBrowse(); await jlRound();
  } else {
    JL.chain.push(JL.q.right); JL.end = `「${toDisp(o.text)}」不是以「${toDisp(JL.q.ch)}」开头的。正确答案已接在上面，共接上 ${JL.score} 句。`; JL.q = null;
    renderBrowse();
  }
}

/* ---------------- 学习列表（我的诗单）：多个列表、粘贴诗名、练习、分享、打印 ---------------- */
let listView = "", listEdit = false, listDelArm = "", matchRes = null, alPoem = null;
const itemPoem = (it) => { const p = it.p; return p.source === "daily" && p.dailyIndex != null && DAILY[p.dailyIndex] ? dailyPoem(p.dailyIndex) : { ...p }; };
function renderMine(body) {
  const l = listView && lists.get(listView);
  if (l) { renderListDetail(body, l); return; }
  listView = "";
  const t = study.todayParts();
  const L = lists.all();
  const card = (l, i) => {
    const last = Object.keys(l.log || {}).sort().pop();
    const meta = [`${l.items.length} 首`, last === t.ymd ? `<span class="ls-done">今天已打卡</span>` : last ? `上次练习 ${last.slice(5).replace("-", "/")}` : ""].filter(Boolean).join(" · ");
    return `<li class="ls-card"><button class="ls-open" type="button" data-ls-open="${esc(l.id)}"><b>${esc(toDisp(l.name))}</b><small>${meta}</small></button>
      <span class="ls-acts"><button type="button" class="ls-mv" data-ls-mv="${esc(l.id)}|-1" aria-label="上移" ${i ? "" : "disabled"}>↑</button><button type="button" class="ls-mv" data-ls-mv="${esc(l.id)}|1" aria-label="下移" ${i < L.length - 1 ? "" : "disabled"}>↓</button>
      <button type="button" class="btn solid ls-go" data-ls-practice="${esc(l.id)}" ${l.items.length ? "" : "disabled"}>练习</button></span></li>`;
  };
  const rec = Object.entries(study.recites()).map(([k, r]) => ({ k, r, st: study.reciteState(k, t).state }))
    .sort((a, b) => ({ due: 0, wait: 1, done: 2 }[a.st] - { due: 0, wait: 1, done: 2 }[b.st]));
  const lab = { due: "今天复习", wait: "", done: "已掌握" };
  body.innerHTML = `<p class="b-h">学习列表 <small>按列表定向练习，比如今天的作业</small></p>
    <ol class="ls-list">${L.map(card).join("")}</ol>
    <div class="ls-new"><form class="pop-row" data-ls-new><input type="text" maxlength="24" placeholder="新列表的名字" aria-label="新列表的名字"><button class="btn ghost" type="submit">新建</button></form>
      <button class="btn ghost ls-hw" type="button" data-ls-hw>＋ ${esc(lists.homeworkName(t.ymd))}</button></div>
    <p class="b-h">背诵打卡 <small>背会后按 1、2、4、7、15 天提醒复习</small></p>
    ${rec.length ? `<ol class="results">${rec.map(({ r, st }) => { browseItems.push(r.p); return poemBtn(r.p, browseItems.length - 1, st === "wait" ? `<span class="res-badge">${esc(r.next.slice(5).replace("-", "/"))} 复习</span>` : `<span class="res-badge${st === "due" ? " due" : ""}">${lab[st]}</span>`); }).join("")}</ol>` : `<p class="muted b-empty">读完一首，点诗笺下方的「背会了」开始打卡</p>`}
    <p class="b-note">列表、收藏和打卡只存在这台设备的浏览器里，不需要账号。点诗笺下方的「收藏」会放进「我的诗单」。</p>`;
}
function renderListDetail(body, l) {
  const D = (x) => esc(toDisp(x || ""));
  const title = listEdit
    ? `<form class="pop-row ls-rename" data-ls-rename><input type="text" maxlength="24" value="${D(l.name)}" aria-label="列表名字"><button class="btn solid" type="submit">保存</button><button class="btn text" type="button" data-ls-edit>取消</button></form>`
    : `<h3 class="ls-h">${D(l.name)}</h3><button class="btn text" type="button" data-ls-edit>改名</button>`;
  const match = matchRes && matchRes.id === l.id ? `<ol class="ls-match">${matchRes.rows.map((r) => r.p
      ? `<li class="ok"><i>✓</i><b>${D(r.p.title)}</b><small>${D(r.p.author)} · ${r.src}${r.dup ? " · 已在列表里" : ""}</small></li>`
      : `<li class="no"><i>✗</i><b>${D(r.q)}</b><small>没找到，换个写法或加上作者试试</small></li>`).join("")}</ol>
      ${matchRes.rows.some((r) => r.p && !r.dup) ? `<button class="btn solid" type="button" data-ls-addmatched>加入 ${matchRes.rows.filter((r) => r.p && !r.dup).length} 首</button>` : ""}` : "";
  body.innerHTML = `<button class="btn text ls-back" type="button" data-ls-back>‹ 全部列表</button>
    <div class="ls-title">${title}</div>
    <div class="ls-tools"><button class="btn solid" type="button" data-ls-practice="${esc(l.id)}" ${l.items.length ? "" : "disabled"}>开始练习</button>
      <button class="btn ghost" type="button" data-ls-share ${l.items.length ? "" : "disabled"}>分享链接</button>
      <button class="btn ghost" type="button" data-ls-print ${l.items.length ? "" : "disabled"}>打印列表</button>
      ${l.id !== lists.MINE ? `<button class="btn text ls-del" type="button" data-ls-del>${listDelArm === l.id ? "确认删除？" : "删除列表"}</button>` : ""}</div>
    <p class="b-h">添加诗 <small>每行一个诗名，可以带作者</small></p>
    <form class="ls-paste" data-ls-paste><textarea rows="4" placeholder="粘贴或输入诗名，例如：&#10;春晓&#10;静夜思 李白&#10;李白《赠汪伦》" aria-label="诗名"></textarea>
      <div class="pop-row"><button class="btn ghost" type="submit">匹配诗名</button><small class="muted">也可以在搜索结果里点「＋」</small></div></form>
    ${match}
    <p class="b-h">${l.items.length} 首</p>
    ${l.items.length ? `<ol class="results ls-items">${l.items.map((it, i) => { browseItems.push(itemPoem(it)); const d = view(it.p).disp;
      return `<li class="res-li"><button class="res" type="button" data-bp="${browseItems.length - 1}"><span class="res-t"><span class="ls-n">${i + 1}</span>${esc(d.title)}</span><span class="res-m">${esc(d.author)}</span><span class="res-l">${esc(d.lines[0] || "")}</span></button>
        <span class="ls-iacts"><button type="button" data-li-mv="${esc(it.k)}|-1" aria-label="上移" ${i ? "" : "disabled"}>↑</button><button type="button" data-li-mv="${esc(it.k)}|1" aria-label="下移" ${i < l.items.length - 1 ? "" : "disabled"}>↓</button><button type="button" data-li-del="${esc(it.k)}" aria-label="移出列表">×</button></span></li>`; }).join("")}</ol>`
      : `<p class="muted b-empty">还没有诗。在上面粘贴诗名，或者在搜索结果、诗笺下方点「加入列表」。</p>`}`;
}
/** 粘贴的诗名 → 课本 72 首 + 全唐诗 / 全宋诗诗名索引（本站托管）；都没有时再问诗库 */
async function matchTitles(text) {
  const rows = [];
  for (const q of lists.parseTitles(toSimp(text))) {
    const tries = [{ t: q.t, a: q.a }];
    if (q.a && q.raw !== q.t) tries.push({ t: q.raw, a: "" });
    let hit = null;
    for (const x of tries) {
      const bt = baseTitle(x.t);
      const i = DAILY.findIndex((d) => (baseTitle(d.t) === bt || d.t === x.t) && (!x.a || d.a === x.a));
      if (i >= 0) { hit = { p: dailyPoem(i), src: "课本" }; break; }
      try {
        const ids = await api.cpTitleIds(x.t, 8);
        if (ids.length) {
          const ps = await api.cpPoems(ids.slice(0, 8));
          const norm = (t) => api.yuefuTitle(t).title.replace(/[其之]?[一二三四五六七八九十]+$/, "");
          const p = ps.find((p) => norm(p.title) === norm(x.t) && (!x.a || p.author === x.a)) || (!x.a && ps.find((p) => norm(p.title) === norm(x.t)));
          if (p) { hit = { p, src: p.dynasty === "宋" ? "宋诗" : "唐诗" }; break; }
        }
      } catch { /* 索引或正文取不到 */ }
    }
    if (!hit) {
      try { const p = await api.findPoem({ t: q.t, a: q.a }) || (q.a && q.raw !== q.t ? await api.findPoem({ t: q.raw, a: "" }) : null); if (p) hit = { p: view(p).simp, src: "诗库" }; } catch { /* 诗库连不上 */ }
    }
    rows.push(hit ? { q: q.raw, ...hit } : { q: q.raw });
  }
  return rows;
}
function practicePop(anchor, id) {
  closePop();
  const steps = store.get("practiceSteps", ["read", "follow", "veil", "dict"]);
  const names = { read: "朗读", follow: "看拼音跟读", veil: "遮字背诵", dict: "填空默写" };
  const l = lists.get(id); if (!l) return;
  openPop(`<h3><span>开始练习</span><small>${esc(toDisp(l.name))} · ${l.items.length} 首</small></h3>
    <p class="pop-note">每首诗按顺序走这几步，最后选「已会」或「再练」（再练的排到最后再来一遍）</p>
    <div class="pchks pk-steps">${Object.entries(names).map(([k, n], i) => `<label class="pchk"><input type="checkbox" data-pk-step="${k}" ${steps.includes(k) ? "checked" : ""}> ${i + 1}. ${n}</label>`).join("")}</div>
    <label class="pchk"><input type="checkbox" data-pk-sched ${store.get("practiceSched", false) ? "checked" : ""}> 练完把已会的诗加入背诵复习</label>
    <div class="pop-row"><button class="btn solid" type="button" data-pk-go="${esc(id)}">开始</button></div>`, anchor, { sheetOnMobile: true, cls: "pop-practice" });
}
let PRACTICE = null;
async function startPractice(id) {
  const pop = $("pop");
  const steps = [...pop.querySelectorAll("[data-pk-step]")].filter((x) => x.checked).map((x) => x.dataset.pkStep);
  const sched = !!(pop.querySelector("[data-pk-sched]") || {}).checked;
  if (!steps.length) { toast("至少选一步"); return; }
  store.set("practiceSteps", steps); store.set("practiceSched", sched);
  const l = lists.get(id); if (!l || !l.items.length) return;
  closePop(); closeBrowse();
  try { PRACTICE = PRACTICE || await import("./practice.js"); } catch { toast("练习模块没有载入，请检查网络"); return; }
  await PRACTICE.start(PCTX, l, { steps, schedule: sched });
}
const dictStatus = () => {
  if (!state.dict) return null;
  const total = state.dict.blanks.size, done = Object.keys(state.dict.answers).length;
  const ok = Object.entries(state.dict.answers).filter(([k, v]) => (findCell(k) || {}).ch === v).length;
  return { total, done, ok };
};
const PCTX = {
  disp: (s) => toDisp(s), toast: (m, ms) => toast(m, ms), modal: (h, c) => modal(h, c), closeModal: () => closeModal(),
  openItem: async (it) => { setPoem(itemPoem(it), { focus: false }); },
  setVeil: (on) => { if (state.view.veil !== on) setVeil(on); },
  setPinyin: (on) => { if (state.view.pinyin !== on) setPinyin(on); },
  startDict: () => { if (!state.dict) toggleDictation(); },
  endDict: () => { if (state.dict) { state.dict = null; draw(false); } },
  dictStatus,
  ttsOk: () => !$("btnRead").hidden,
  speakAll: () => { if (!$("btnRead").hidden) speak("all"); },
  stopSpeak: () => { study.stopSpeak(); setSpeakingUI(false); },
  checkIn: (p) => study.checkIn(pkey(p), p).changed,
  logPractice: (id, rec) => lists.logPractice(id, study.todayParts().ymd, rec),
  onEnd: () => syncStudy(),
};
/** 「加入列表」：从诗笺或搜索结果 */
function addListPop(anchor, p) {
  if (popAnchor === anchor) { closePop(); return; }
  closePop();
  alPoem = p;
  drawAddList(anchor);
}
function drawAddList(anchor) {
  const p = alPoem, k = lists.keyOf(p), t = study.todayParts();
  const hw = lists.homeworkName(t.ymd);
  openPop(`<h3><span>加入学习列表</span><small>${esc(toDisp(baseTitle(p.title)))}</small></h3>
    <div class="al-list">${lists.all().map((l) => { const on = lists.has(l.id, k); return `<button type="button" class="al-item" data-al-toggle="${esc(l.id)}" aria-pressed="${on}"><i>${on ? "✓" : "＋"}</i>${esc(toDisp(l.name))}<small>${l.items.length} 首</small></button>`; }).join("")}</div>
    ${lists.all().some((l) => l.name === hw) ? "" : `<button type="button" class="btn text al-hw" data-al-hw>＋ 新建「${esc(hw)}」并加入</button>`}
    <form class="pop-row" data-al-new><input type="text" maxlength="24" placeholder="新列表的名字" aria-label="新列表的名字"><button class="btn ghost" type="submit">新建并加入</button></form>`, anchor, { sheetOnMobile: true, cls: "pop-addlist" });
}
function alToggle(id) {
  const p = alPoem, k = lists.keyOf(p), l = lists.get(id); if (!l) return;
  if (lists.has(id, k)) { lists.drop(id, k); toast(`已从「${toDisp(l.name)}」移出`, 1400); }
  else { lists.add(id, p); toast(`已加入「${toDisp(l.name)}」`, 1400); }
  const anchor = popAnchor; closePop(); if (anchor) { drawAddList(anchor); }
  syncStudy();
}
function sharePop(anchor, l) {
  closePop();
  const url = location.origin + location.pathname + lists.shareHash(l);
  openPop(`<h3><span>分享列表</span><small>${esc(toDisp(l.name))} · ${l.items.length} 首</small></h3>
    <p class="pop-note">把链接发给孩子或学生，对方打开后确认即可导入。链接里只有诗的编号和列表名，不含任何个人记录。</p>
    <div class="pop-row"><input type="text" readonly value="${esc(url)}" data-share-url aria-label="分享链接"><button class="btn solid" type="button" data-share-copy>复制</button></div>
    ${navigator.share ? `<div class="pop-row"><button class="btn ghost" type="button" data-share-native>用系统分享…</button></div>` : ""}`, anchor, { sheetOnMobile: true, cls: "pop-share" });
}
const PLIST_DEFAULT = { py: true, big: false, yi: false, ci: false };
function printListPop(anchor, l) {
  closePop();
  const o = Object.assign({}, PLIST_DEFAULT, store.get("printListOpts", {}));
  const box = (k, label) => `<label class="pchk"><input type="checkbox" data-plopt="${k}" ${o[k] ? "checked" : ""}> ${label}</label>`;
  openPop(`<h3><span>打印列表</span><small>${esc(toDisp(l.name))} · ${l.items.length} 首</small></h3>
    <div class="pchks">${box("py", "拼音")}${box("big", "大字")}${box("yi", "译文")}${box("ci", "注释")}</div>
    <p class="pop-note">每首诗依次排在 A4 纸上；译文、注释只有收录了赏析的诗才有。</p>
    <div class="pop-row"><button class="btn solid" type="button" data-pl-go>打印</button></div>`, anchor, { sheetOnMobile: true, cls: "pop-print" });
}
async function doPrintList(l) {
  closePop();
  const o = Object.assign({}, PLIST_DEFAULT, store.get("printListOpts", {}));
  try { await loadSide(); } catch { /* 没有赏析数据：只印诗 */ }
  let box = $("printList");
  if (!box) { box = document.createElement("div"); box.id = "printList"; box.className = "print-list"; document.body.appendChild(box); }
  const ann = { textbook: state.settings.textbook, recite: state.settings.recite, overrides: {} };
  box.innerHTML = `<h1 class="pl-h">${esc(toDisp(l.name))}</h1>` + l.items.map((it, i) => {
    const p = itemPoem(it), { disp, simp } = view(p);
    const lines = glyphs(annotate(simp.lines, ann), disp.lines);
    const n = noteFor(p);
    const ex = [o.yi && n && n.yi ? `<h4>译文</h4><p>${esc(toDisp(n.yi))}</p>` : "", o.ci && n && n.ci ? `<h4>注释</h4><p>${esc(Object.entries(n.ci).map(([w, m]) => `${toDisp(w)}：${toDisp(m)}`).join("；"))}</p>` : ""].join("");
    return `<section class="pl-poem"><h2><span class="pl-n">${i + 1}</span>${esc(splitTitle(disp.title).main)}</h2><p class="pl-meta">${esc([disp.dynasty, disp.author].filter(Boolean).join(" · "))}</p>
      ${lines.map((cells) => `<p class="pl-line">${cells.map((c) => c.han ? `<span class="pl-c"><i>${esc(c.py)}</i><b>${esc(c.ch)}</b></span>` : `<span class="pl-c pl-p"><i></i><b>${esc(c.ch)}</b></span>`).join("")}</p>`).join("")}${ex ? `<div class="pl-ex">${ex}</div>` : ""}</section>`;
  }).join("");
  document.body.classList.add("print-listing");
  document.body.classList.toggle("print-nopy", !o.py);
  document.body.classList.toggle("print-big", !!o.big);
  await fonts.ready(box.textContent);
  window.print();
}
/* ---------------- 通用确认框 ---------------- */
let MODAL = null;
function modal(html, cls = "") {
  if (!MODAL) {
    MODAL = document.createElement("div");
    MODAL.className = "modal-wrap"; MODAL.hidden = true;
    MODAL.innerHTML = `<div class="modal-scrim"></div><div class="pop pmodal" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(MODAL);
    MODAL.querySelector(".modal-scrim").addEventListener("click", () => closeModal());
  }
  const box = MODAL.querySelector(".pmodal");
  box.className = "pop pmodal " + cls; box.innerHTML = html; box.onclick = null;
  MODAL.hidden = false;
  const f = box.querySelector("button.solid"); if (f) f.focus({ preventScroll: true });
  return box;
}
function closeModal() { if (MODAL) { MODAL.hidden = true; MODAL.querySelector(".pmodal").innerHTML = ""; } }
/* ---------------- 分享链接导入 · 足迹地图深链（#list=… / #map=苏轼） ---------------- */
async function resolveRef(r) {
  const x = lists.parseRef(r); if (!x) return null;
  if (x.d != null) return DAILY[x.d] ? dailyPoem(x.d) : null;
  if (x.c != null) { const ps = await api.cpPoems([x.c]); return ps[0] || null; }
  const i = DAILY.findIndex((d) => baseTitle(d.t) === baseTitle(x.t) && (!x.a || d.a === x.a));
  if (i >= 0) return dailyPoem(i);
  const p = await api.findPoem({ t: x.t, a: x.a, f: x.f });
  return p ? view(p).simp : null;
}
function clearHash() { history.replaceState(null, "", location.pathname + location.search); }
async function handleHash() {
  const h = location.hash;
  const m = h.match(/^#map(?:=(.*))?$/);
  if (m) { clearHash(); openMap({ poet: m[1] ? decodeURIComponent(m[1]) : "" }); return; }
  const sh = lists.parseHash(h);
  if (!sh) return;
  clearHash();
  const box = modal(`<h3><span>收到一份诗单</span></h3>
    <p class="ps-lead">「${esc(toDisp(sh.name))}」，共 ${sh.refs.length} 首。导入到我的学习列表吗？</p>
    <p class="pop-note">导入后只保存在这台设备上，可以随时删除。</p>
    <div class="pop-row"><button class="btn solid" type="button" data-imp-go>导入</button><button class="btn text" type="button" data-imp-no>不用了</button></div>`, "pimport");
  box.onclick = async (e) => {
    if (e.target.closest("[data-imp-no]")) { closeModal(); return; }
    const go = e.target.closest("[data-imp-go]"); if (!go) return;
    go.disabled = true; go.textContent = "正在取诗…";
    const got = await Promise.all(sh.refs.map((r) => resolveRef(r).catch(() => null)));
    const poems = got.filter(Boolean);
    closeModal();
    if (!poems.length) { toast("没能取到这些诗，请检查网络后再打开链接"); return; }
    const l = lists.importList(sh.name, poems);
    toast(poems.length === sh.refs.length ? `已导入「${toDisp(l.name)}」，${poems.length} 首` : `已导入 ${poems.length} 首，${sh.refs.length - poems.length} 首没有找到`, 2600);
    listView = l.id; matchRes = null;
    openBrowse("mine");
  };
}
let MAP = null;
async function openMap(opts = {}) {
  closePop(); closeBrowse(); closeSheet();
  try {
    MAP = MAP || await import("./map.js");
    await MAP.open({ disp: (s) => toDisp(s), VQ, openPoem: openFootPoem }, opts);
  } catch (e) { console.warn(e); toast("足迹地图没有载入，请检查网络"); }
}
/** 地图上点诗名：课本诗直接打开；全唐诗 / 全宋诗按编号取；宋词等在诗库里按 诗名 + 作者 + 首句 认出来 */
async function openFootPoem(e, poet) {
  let p = null;
  try {
    if (e.d != null && DAILY[e.d]) p = dailyPoem(e.d);
    else if (e.c != null) { toast("正在取诗…", 1200); p = (await api.cpPoems([e.c]))[0] || null; }
    if (!p) { toast(`正在诗库里找《${toDisp(e.t)}》…`, 1600); p = await api.findPoem({ t: e.t, a: poet, f: e.f || "", q: e.q || "" }); }
  } catch { p = null; }
  if (p) { setPoem(p); return true; }
  const q = `${poet} ${String(e.q || e.t).split("·")[0]}`;
  MAP.close();
  toast("诗库里暂时没认出这首，先看看搜索结果", 2200);
  $("q").value = toDisp(q); openSheet(toDisp(q)); fullSearch(toDisp(q));
  return false;
}

function bindStudy() {
  $("btnRead").addEventListener("click", (e) => readPop(e.currentTarget));
  $("btnDictate").addEventListener("click", () => toggleDictation());
  $("btnFav").addEventListener("click", () => { if (!state.poem) return; const on = study.toggleFav(pkey(state.poem), view(state.poem).simp); lists.favChanged(pkey(state.poem), view(state.poem).simp, on); syncStudy(); toast(on ? "已收藏，在「诗单」里能找到" : "已取消收藏", 1600); });
  $("btnRecited").addEventListener("click", () => {
    if (!state.poem) return;
    const k = pkey(state.poem);
    const r = study.checkIn(k, view(state.poem).simp);
    syncStudy();
    if (!r.changed) { toast(r.r.stage >= study.INTERVALS.length ? "这首已经掌握了" : `下次复习：${r.r.next}`, 1800); return; }
    toast(r.r.stage === 0 ? `背会了！${study.INTERVALS[0]} 天后提醒复习` : r.r.next ? `复习打卡，下次 ${r.r.next}` : "五次复习都完成了，已掌握", 2200);
  });
  $("dueChip").addEventListener("click", () => openBrowse("mine"));
  $("btnBrowse").addEventListener("click", () => openBrowse());
  $("browseClose").addEventListener("click", () => closeBrowse());
  $("scrim").addEventListener("click", () => closeBrowse());
  $("browse").addEventListener("click", async (e) => {
    const t = e.target.closest("[data-tab]"); if (t) { browseTab = t.dataset.tab; if (browseTab !== "mine") listView = ""; renderBrowse(); return; }
    const mp = e.target.closest("[data-map]"); if (mp) { openMap({ poet: mp.dataset.map }); return; }
    // 学习列表
    const lo = e.target.closest("[data-ls-open]"); if (lo) { listView = lo.dataset.lsOpen; listEdit = false; listDelArm = ""; matchRes = null; renderBrowse(); $("browseBody").scrollTop = 0; return; }
    if (e.target.closest("[data-ls-back]")) { listView = ""; listEdit = false; matchRes = null; renderBrowse(); return; }
    const lm = e.target.closest("[data-ls-mv]"); if (lm) { const [id, d] = lm.dataset.lsMv.split("|"); lists.move(id, +d); renderBrowse(); return; }
    const lp = e.target.closest("[data-ls-practice]"); if (lp) { practicePop(lp, lp.dataset.lsPractice); return; }
    if (e.target.closest("[data-ls-hw]")) {
      const n = lists.homeworkName(study.todayParts().ymd);
      const ex = lists.all().find((l) => l.name === n);
      listView = (ex || lists.create(n)).id; matchRes = null; renderBrowse();
      const ta = $("browseBody").querySelector("[data-ls-paste] textarea"); if (ta && !isMobile()) ta.focus();
      return;
    }
    if (e.target.closest("[data-ls-edit]")) { listEdit = !listEdit; renderBrowse(); const i = $("browseBody").querySelector("[data-ls-rename] input"); if (i) i.select(); return; }
    if (e.target.closest("[data-ls-del]")) {
      if (listDelArm !== listView) { listDelArm = listView; renderBrowse(); return; }
      const l = lists.get(listView); lists.remove(listView); listDelArm = ""; listView = ""; renderBrowse(); if (l) toast(`已删除「${toDisp(l.name)}」`, 1600); return;
    }
    const cur = listView && lists.get(listView);
    if (cur && e.target.closest("[data-ls-share]")) { sharePop(e.target.closest("[data-ls-share]"), cur); return; }
    if (cur && e.target.closest("[data-ls-print]")) { printListPop(e.target.closest("[data-ls-print]"), cur); return; }
    const im = e.target.closest("[data-li-mv]"); if (im && cur) { const v = im.dataset.liMv, j = v.lastIndexOf("|"); lists.moveItem(cur.id, v.slice(0, j), +v.slice(j + 1)); renderBrowse(); return; }
    const idl = e.target.closest("[data-li-del]"); if (idl && cur) { lists.drop(cur.id, idl.dataset.liDel); renderBrowse(); syncStudy(); return; }
    if (cur && e.target.closest("[data-ls-addmatched]")) {
      let n = 0; (matchRes ? matchRes.rows : []).forEach((r) => { if (r.p && !r.dup && lists.add(cur.id, r.p)) n++; });
      matchRes = null; renderBrowse(); syncStudy(); toast(`已加入 ${n} 首`, 1600); return;
    }
    const sel = e.target.closest("[data-bsel]"); if (sel) { browseSel = browseSel === sel.dataset.bsel ? "" : sel.dataset.bsel; renderBrowse(); return; }
    const bp = e.target.closest("[data-bp]"); if (bp) { const p = browseItems[+bp.dataset.bp]; if (p) { closeBrowse(); setPoem(p.source === "daily" && p.dailyIndex != null && DAILY[p.dailyIndex] ? dailyPoem(p.dailyIndex) : { ...p }); } return; }
    if (e.target.closest("[data-jl-start]")) { e.target.closest("[data-jl-start]").disabled = true; await jlStart(); return; }
    const jp = e.target.closest("[data-jl-pick]"); if (jp) { jlPick(+jp.dataset.jlPick); }
  });
  $("browse").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.matches("[data-ls-new]")) {
      const v = f.querySelector("input").value.trim();
      if (!v) { toast("先给列表起个名字"); f.querySelector("input").focus(); return; }
      listView = lists.create(v).id; matchRes = null; renderBrowse(); return;
    }
    if (f.matches("[data-ls-rename]")) { lists.rename(listView, f.querySelector("input").value); listEdit = false; renderBrowse(); return; }
    if (f.matches("[data-ls-paste]")) {
      const text = f.querySelector("textarea").value;
      if (!text.trim()) { toast("先粘贴或输入几个诗名"); return; }
      const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "正在匹配…";
      const id = listView;
      const rows = await matchTitles(text);
      const l = lists.get(id);
      rows.forEach((r) => { if (r.p && l) r.dup = lists.has(id, lists.keyOf(r.p)); });
      matchRes = { id, rows };
      if (listView === id) renderBrowse();
    }
  });
  $("cardTip").addEventListener("click", (e) => {
    if (e.target.closest("[data-dict-end]")) { state.dict = null; draw(false); }
    if (e.target.closest("[data-dict-again]")) { state.dict = null; toggleDictation(); }
  });
  $("sideNote").addEventListener("click", (e) => { const r = e.target.closest("[data-rel]"); if (r) setPoem(dailyPoem(+r.dataset.rel)); });
  $("pop").addEventListener("click", (e) => {
    const pk = e.target.closest("[data-dict-pick]"); if (pk) { dictAnswer($("pop").dataset.k, pk.dataset.dictPick); return; }
    if (e.target.closest("[data-read-all]")) { speak("all"); return; }
    const rl = e.target.closest("[data-read-line]"); if (rl) { speak(+rl.dataset.readLine); return; }
    if (e.target.closest("[data-do-print]")) { doPrint(); return; }
    const pg = e.target.closest("[data-pk-go]"); if (pg) { startPractice(pg.dataset.pkGo); return; }
    const at = e.target.closest("[data-al-toggle]"); if (at) { alToggle(at.dataset.alToggle); return; }
    if (e.target.closest("[data-al-hw]")) { const n = lists.homeworkName(study.todayParts().ymd); const l = lists.all().find((x) => x.name === n) || lists.create(n); if (!lists.has(l.id, lists.keyOf(alPoem))) alToggle(l.id); return; }
    if (e.target.closest("[data-share-copy]")) { const u = $("pop").querySelector("[data-share-url]"); copyText(u.value).then((ok) => toast(ok ? "链接已复制，发给对方即可" : "复制失败，请长按链接手动复制", 2000)); u.select(); return; }
    if (e.target.closest("[data-share-native]")) { const u = $("pop").querySelector("[data-share-url]").value; navigator.share({ title: "吟诗 · 诗单", url: u }).catch(() => {}); return; }
    if (e.target.closest("[data-pl-go]")) { const l = lists.get(listView); if (l) doPrintList(l); return; }
    if (e.target.closest("[data-do-export]")) { closePop(); $("btnImage").click(); }
  });
  $("pop").addEventListener("input", (e) => {
    if (e.target.matches("[data-read-rate]")) { state.rate = +e.target.value; store.set("rate", state.rate); const v = $("rateVal"); if (v) v.textContent = state.rate.toFixed(1); }
  });
  $("pop").addEventListener("change", (e) => {
    if (e.target.matches("[data-read-loop]")) store.set("readLoop", e.target.checked);
    if (e.target.matches("[data-popt]")) { const o = printOpts(); o[e.target.dataset.popt] = e.target.checked; store.set("printOpts", o); }
    if (e.target.matches("[data-plopt]")) { const o = Object.assign({}, PLIST_DEFAULT, store.get("printListOpts", {})); o[e.target.dataset.plopt] = e.target.checked; store.set("printListOpts", o); }
  });
  $("pop").addEventListener("submit", (e) => {
    if (e.target.matches("[data-al-new]")) {
      e.preventDefault(); e.stopImmediatePropagation();
      const v = e.target.querySelector("input").value.trim();
      if (!v) { toast("先给列表起个名字"); return; }
      const l = lists.create(v); alToggle(l.id); return;
    }
    if (!e.target.matches("[data-dict-type]")) return;
    e.preventDefault(); e.stopImmediatePropagation();
    dictAnswer($("pop").dataset.k, e.target.querySelector("input").value);
  }, true);
  window.addEventListener("afterprint", () => { document.body.classList.remove("print-nopy", "print-big", "print-listing"); });
  $("btnAddList").addEventListener("click", (e) => { if (state.poem) addListPop(e.currentTarget, view(state.poem).simp); });
  window.addEventListener("hashchange", () => handleHash());
  study.ttsReady().then((ok) => { $("btnRead").hidden = !ok; });
}

/* ---------------- 启动：不请求 API ---------------- */
async function boot() {
  bind();
  bindStudy();
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
  // 今日一诗：逢节日、节气（北京时间）优先选应景的课本诗
  let first = todayIndex(), tag;
  try {
    CATALOG = await fetch("data/catalog.json" + VQ).then((r) => r.json());
    const sp = study.seasonPick(CATALOG);
    if (sp) {
      const i = DAILY.findIndex((d) => sp.poems.includes(d.t + "|" + d.a));
      if (i >= 0) { first = i; tag = sp.name; }
    }
  } catch { /* 分类数据没载入：照常轮换 */ }
  setPoem(dailyPoem(first), { focus: false, tag });
  if (tag) state.view.today = true, draw(false);
  handleHash();
}
fonts.apply();
themes.apply();
boot();
