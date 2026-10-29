// 吟诗 · 主程序
import * as store from "./store.js";
import * as api from "./api.js";
import { loadFixes, annotate, optionsFor, normalizePinyin, HAN } from "./reading.js";
import { renderPoem, fit } from "./render.js";
import { cardToPNG, download, poemToText, copyText } from "./exporter.js";
import * as fonts from "./fonts.js";

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
const FALLBACK_DYN = ["先秦", "两汉", "魏晋", "南北朝", "隋", "唐", "五代", "宋", "元", "明", "清"];
const FALLBACK_TYPE = ["五言绝句", "七言绝句", "五言律诗", "七言律诗", "五言古诗", "七言古诗", "乐府诗", "宋词", "元曲", "诗经", "楚辞"];

let DAILY = [];
const state = {
  poem: null, alt: null,
  view: { mode: store.get("mode", "h"), vdir: store.get("vdir", "rl") === "lr" ? "lr" : "rl", pinyin: store.get("pinyin", true), veil: false, veiled: new Set(), today: false, tag: "", hi: "" },
  settings: Object.assign({ textbook: true, recite: false }, store.get("settings", {})),
  display: Object.assign({}, DISPLAY_DEFAULT, store.get("display", {})),
  filters: Object.assign({ dynasty: "", types: [], author: "" }, store.get("filters", {})),
  ann: null,
  search: { q: "", page: 1, local: [], remote: [], author: null },
};
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

/* ---------------- 诗 → 屏幕 ---------------- */
// 「赋得古原草送别（节选）」→ 主标题 + 小注「节选」
export function splitTitle(t) {
  const m = String(t || "").match(/^(.*?)[（(]([^）)]*)[）)]\s*$/);
  return m && m[1].trim() ? { main: m[1].trim(), sub: m[2].trim() } : { main: String(t || "").trim(), sub: "" };
}
function ovKey(p) { return "ov:" + store.hash(p.title + "|" + p.author + "|" + p.lines.join("/")); }
function overrides() { return state.poem ? store.get(ovKey(state.poem), {}) : {}; }

function setPoem(p, opts = {}) {
  state.poem = p;
  state.view.hi = opts.hi || "";
  state.view.today = p.source === "daily" && p.dailyIndex === todayIndex();
  state.view.tag = p.source === "daily" ? "小学必背" : (p.type && p.type !== "其他" ? p.type : "诗库");
  state.view.veiled = new Set(state.view.veil ? p.lines.map((_, i) => i) : []);
  state.alt = opts.alt !== undefined ? opts.alt : null;
  if (p.source === "api" && opts.alt === undefined) {
    const tb = findTextbook(p);
    if (tb && hanOnly(tb.lines.join("")) !== hanOnly(p.lines.join(""))) state.alt = { poem: tb, from: p, toTextbook: true };
  }
  draw(true);
  closeSheet(); closePop();
  if (opts.focus !== false && !isMobile()) $("poem").focus({ preventScroll: true });
  if (isMobile()) window.scrollTo({ top: 0, behavior: "smooth" });
}

function draw(animate = false) {
  const p = state.poem;
  if (!p) return;
  const o = { textbook: state.settings.textbook, recite: state.settings.recite, overrides: overrides(), hi: state.view.hi };
  state.ann = {
    title: annotate([splitTitle(p.title).main], { ...o, prefix: "t", hi: "" }),
    lines: annotate(p.lines, o),
  };
  applyDisplay();
  renderPoem($("poemView"), p, state.ann, { ...state.view, animate, sub: splitTitle(p.title).sub });
  // 底注：课本版切换
  const note = $("cardNote");
  if (state.alt) {
    note.hidden = false;
    note.innerHTML = state.alt.toTextbook
      ? `<span>诗库里的文字和课本不太一样</span><button class="btn ghost" type="button" data-alt>改用课本版</button>`
      : `<span>当前为课本版</span><button class="btn ghost" type="button" data-alt>改回诗库版</button>`;
  } else { note.hidden = true; note.innerHTML = ""; }
  document.title = `${p.title} · ${p.author ? p.author + " · " : ""}吟诗`;
  syncControls();
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
  const k = q.replace(/[\s，。！？、；：,.!?]/g, "");
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

const poemKey = (p) => baseTitle(p.title) + "|" + p.author;
function resItem(p, i, q, badge) {
  return `<li><button class="res" type="button" data-i="${i}">
      <span class="res-t">${hl(p.title, q)}${badge ? `<span class="res-badge">${badge}</span>` : ""}</span>
      <span class="res-m">${esc(p.author)} · ${esc(p.dynasty)}</span>
      <span class="res-l">${hl(firstLineWith(p, q), q)}</span>
    </button></li>`;
}
function renderResults() {
  const { q, local, remote, author } = state.search;
  const ol = $("results");
  const au = author && author.list.length ? author : null;
  const items = [];
  const html = [];
  let localShown = local;
  if (au) {
    // 课本里也有的，用课本版并标「课本」，下面不再重复
    const byKey = new Map(local.map((p) => [poemKey(p), p]));
    const inAu = new Set();
    html.push(`<li class="res-sec">${esc(au.name)}的诗</li>`);
    au.list.forEach((p) => {
      const t = byKey.get(poemKey(p)); if (t) inAu.add(poemKey(p));
      html.push(resItem(t || p, items.length, "", t ? "课本" : "")); items.push(t || p);
    });
    localShown = local.filter((p) => !inAu.has(poemKey(p)));
    if (au.hasMore) html.push(`<li class="res-more"><button class="btn text" type="button" data-more-author ${au.loading ? "disabled" : ""}>${au.loading ? "正在翻…" : `更多${esc(au.name)}的诗`}</button></li>`);
    if (localShown.length || remote.length) html.push(`<li class="res-sec">诗名与诗句</li>`);
  }
  localShown.forEach((p) => { html.push(resItem(p, items.length, q, "课本")); items.push(p); });
  remote.forEach((p) => { html.push(resItem(p, items.length, q, "")); items.push(p); });
  if (!items.length) { ol.innerHTML = q ? "" : `<li class="res-empty">输入诗名、诗句或作者，回车搜索整个诗库</li>`; ol._items = []; return; }
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
  const k = hanOnly(q);
  // 2–4 个字、像人名：顺带查「这位作者的诗」，有就排在最前面
  const asAuthor = page === 1 && k.length >= 2 && k.length <= 4 && k === q.replace(/\s+/g, "");
  if (page === 1) state.search = { q, page: 1, local: localSearch(q), remote: [], author: null };
  renderResults();
  setStatus(`<span class="loading">正在翻诗库…</span>`);
  $("btnMore").hidden = true;
  const [sr, ar] = await Promise.allSettled([
    api.search(q, page),
    asAuthor ? api.authorPoems(k, 1) : Promise.resolve(null),
  ]);
  if (state.search.q !== q) return;   // 期间又搜了别的
  if (ar.status === "fulfilled" && ar.value && ar.value.list.length) {
    state.search.author = { name: k, list: ar.value.list, page: 1, hasMore: ar.value.hasMore };
  }
  const au = state.search.author;
  const seen = new Set([...state.search.local, ...(au ? au.list : [])].map(poemKey));
  let hasMore = false;
  if (sr.status === "fulfilled") {
    const fresh = sr.value.list.filter((p) => !seen.has(poemKey(p)));
    state.search.remote = page === 1 ? fresh : state.search.remote.concat(fresh.filter((p) => !state.search.remote.some((r) => poemKey(r) === poemKey(p))));
    state.search.page = page;
    hasMore = sr.value.hasMore;
  }
  renderResults();
  $("btnMore").hidden = !hasMore;
  const n = new Set([...state.search.local, ...state.search.remote, ...(au ? au.list : [])].map(poemKey)).size;
  if (sr.status === "fulfilled") {
    setStatus(n ? `找到 ${n}${hasMore || (au && au.hasMore) ? "+" : ""} 首，点一首读` : `没有找到「${esc(q)}」，换个说法试试`);
    return;
  }
  const e = sr.reason || {};
  if (e.kind === "short") {
    // 诗库不支持一两个字的全文搜索（公共实例）：给出能用的去处
    const btns = [];
    const titleHit = state.search.local.some((p) => baseTitle(p.title).includes(k));
    if (!au && k.length >= 2 && k.length <= 4 && !titleHit) btns.push(`<button class="btn ghost" type="button" data-act="author" data-v="${esc(k)}">随机一首「${esc(k)}」的诗</button>`);
    if (k.length === 1) btns.push(`<button class="btn ghost" type="button" data-act="feihua" data-v="${esc(k)}">飞花令「${esc(k)}」</button>`);
    const lead = n ? `找到 ${n} 首。` : "";
    setStatus(`${lead}诗库暂不支持一两个字的全文搜索，可以多输几个字。${btns.length ? "<br>" + btns.join("") : ""}`);
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
    const have = new Set(au.list.map(poemKey));
    au.list = au.list.concat(r.list.filter((p) => !have.has(poemKey(p))));
    au.page += 1; au.hasMore = r.hasMore;
    const ids = new Set(au.list.map(poemKey));
    state.search.remote = state.search.remote.filter((p) => !ids.has(poemKey(p)));
  } catch (e) { toast(e.message || "加载失败"); }
  finally { au.loading = false; renderResults(); }
}

/* ---------------- 随机 / 飞花令 ---------------- */
let busy = false;
async function doRandom(params = null) {
  if (busy) return;
  busy = true;
  const f = state.filters;
  const p = params || { dynasty: f.dynasty, type: f.types, author: f.author };
  setBusy(true);
  try {
    const poem = await api.random(p);
    if (!poem || !poem.lines.length) { toast(p.author ? `诗库里没找到「${p.author}」的诗` : "这个条件下没有找到诗，换个条件试试"); return; }
    setPoem(poem);
  } catch (e) {
    const pool = p.author ? DAILY.map((_, i) => i).filter((i) => DAILY[i].a === p.author) : DAILY.map((_, i) => i);
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
    const poem = await api.random({ char: ch });
    if (!poem || !poem.lines.length) throw new api.ApiError("empty", `诗库里没找到含「${ch}」的诗`);
    setPoem(poem, { hi: ch });
  } catch (e) {
    const pool = DAILY.map((_, i) => i).filter((i) => DAILY[i].lines.join("").includes(ch));
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
  const fang = fonts.hasFangsong();
  const segBtn = (attr, v, label, on, title = "") => `<button type="button" role="radio" ${attr}="${v}" aria-checked="${on}"${title ? ` title="${esc(title)}" aria-label="${esc(title)}"` : ""}>${label}</button>`;
  openPop(`
    <h3><span>设置</span></h3>
    <div class="set">
      <div class="set-row">
        <b>字体</b>
        <div class="seg seg-sm" role="radiogroup" aria-label="诗文字体">
          ${Object.entries(fonts.FONTS).map(([k, f]) => segBtn("data-font", k, f.short, k === cur,
            k === "fang" && !fang ? "仿宋（依系统）" : f.name)).join("")}
        </div>
        <small>${fang || cur !== "fang" ? "诗文所用字体，导出图片和打印也用它" : "仿宋（依系统）：这台设备没装仿宋，暂以宋体显示"}</small>
      </div>
      ${Object.entries({ size: "字号", py: "拼音", lh: "行距" }).map(([k, label]) => `<div class="set-row">
        <b>${label}</b>
        <div class="seg seg-sm" role="radiogroup" aria-label="${label}">
          ${Object.entries(DISPLAY[k]).map(([v, [name]]) => segBtn(`data-disp-${k}`, v, name, state.display[k] === v)).join("")}
        </div>
      </div>`).join("")}
      <div class="set-row">
        <b>竖排方向</b>
        <div class="seg seg-sm" role="radiogroup" aria-label="竖排方向">
          ${segBtn("data-vdir", "rl", "从右到左", state.view.vdir === "rl")}${segBtn("data-vdir", "lr", "从左到右", state.view.vdir === "lr")}
        </div>
      </div>
      <button class="btn text set-reset" type="button" data-reset-display>恢复默认</button>
      <p class="set-sub">读音</p>
      <label><b>课本读音修正</b><input type="checkbox" data-set="textbook" ${state.settings.textbook ? "checked" : ""}><small>按统编版课本通行读音，如 朝 zhāo、还 huán</small></label>
      <label><b>吟诵旧读</b><input type="checkbox" data-set="recite" ${state.settings.recite ? "checked" : ""}><small>叶音、旧读，如 斜 xiá、衰 cuī；课本已不采用</small></label>
      ${n ? `<button class="btn text" type="button" data-clear-ov>清除本诗的 ${n} 处自定义读音</button>` : ""}
    </div>
  `, anchor, { sheetOnMobile: true, cls: "pop-set" });
}

function setFont(k) {
  fonts.choose(k);
  document.querySelectorAll("#pop [data-font]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.font === k)));
  const sm = document.querySelector("#pop [data-font]")?.closest(".set-row")?.querySelector("small");
  if (sm) sm.textContent = k === "fang" && !fonts.hasFangsong() ? "仿宋（依系统）：这台设备没装仿宋，暂以宋体显示" : "诗文所用字体，导出图片和打印也用它";
  if (state.poem) fit($("poemView"), state.view.mode);
  fonts.ready(state.poem ? state.poem.title + state.poem.lines.join("") : "").then(() => state.poem && fit($("poemView"), state.view.mode));
}
function syncDisplayButtons() {
  ["size", "py", "lh"].forEach((k) => document.querySelectorAll(`#pop [data-disp-${k}]`).forEach((b) =>
    b.setAttribute("aria-checked", String(b.getAttribute("data-disp-" + k) === state.display[k]))));
  document.querySelectorAll("#pop [data-vdir]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.vdir === state.view.vdir)));
  document.querySelectorAll("#pop [data-font]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.font === fonts.current())));
}
function setDisplay(k, v) {
  if (!DISPLAY[k] || !DISPLAY[k][v]) return;
  state.display[k] = v; store.set("display", state.display);
  syncDisplayButtons();
  if (state.poem) { applyDisplay(); fit($("poemView"), state.view.mode); }
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
  draw(false);
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
  if (open) { $("fAuthor").value = state.filters.author; loadMeta(); }
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
    const fo = e.target.closest("[data-font]"); if (fo) { setFont(fo.dataset.font); return; }
    const vd = e.target.closest("[data-vdir]"); if (vd) { setVdir(vd.dataset.vdir); return; }
    const ds = e.target.closest("[data-disp-size],[data-disp-py],[data-disp-lh]");
    if (ds) { const k = ["size", "py", "lh"].find((x) => ds.hasAttribute("data-disp-" + x)); setDisplay(k, ds.getAttribute("data-disp-" + k)); return; }
    if (e.target.closest("[data-reset-display]")) { resetDisplay(); return; }
    if (e.target.closest("[data-clear-ov]")) { store.del(ovKey(state.poem)); closePop(); draw(false); toast("已清除本诗的自定义读音"); }
  });
  $("pop").addEventListener("change", (e) => {
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
    const t = e.target.closest("[data-type]");
    if (t) { const s = new Set(state.filters.types); s.has(t.dataset.type) ? s.delete(t.dataset.type) : s.add(t.dataset.type); state.filters.types = [...s]; saveFilters();
      t.setAttribute("aria-pressed", String(s.has(t.dataset.type))); return; }
  });
  $("fAuthor").addEventListener("change", (e) => { state.filters.author = e.target.value.trim(); saveFilters(); });
  $("btnFilterGo").addEventListener("click", () => { state.filters.author = $("fAuthor").value.trim(); saveFilters(); toggleDrawer(false); doRandom(); });
  $("btnFilterClear").addEventListener("click", () => { state.filters = { dynasty: "", types: [], author: "" }; $("fAuthor").value = ""; saveFilters();
    document.querySelectorAll("#drawer .chip").forEach((c) => c.setAttribute("aria-pressed", "false")); });

  // 导出
  $("btnPrint").addEventListener("click", async () => {
    if (state.poem) await fonts.ready(state.poem.title + state.poem.lines.join(""));
    window.print();
  });
  $("btnCopy").addEventListener("click", async () => {
    if (!state.ann) return;
    toast((await copyText(poemToText(state.poem, state.ann))) ? "已复制带拼音的文本" : "复制失败，请手动选择");
  });
  $("btnImage").addEventListener("click", async () => {
    if (!state.poem) return;
    toast("正在研墨…", 1200);
    try {
      await fonts.ready(state.poem.title + state.poem.lines.join("") + (state.poem.author || "") + (state.poem.dynasty || ""));
      const blob = await cardToPNG($("poem"));
      download(blob, `吟诗-${baseTitle(state.poem.title) || "古诗"}.png`);
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
  try {
    const [daily, fixes] = await Promise.all([
      fetch("poem/daily-poems.json").then((r) => r.json()),
      fetch("poem/poem-readings.json").then((r) => r.json()),
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
boot();
