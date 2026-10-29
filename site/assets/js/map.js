// 诗人足迹地图（按需载入：点「足迹」时才下载本文件与 data/footprints.json、data/rivers.json）
// · 底图是一张写意「山河图」：只画主要河流、几片大湖和几处名山的小记号（Natural Earth 公有领域数据简化而成），
//   不画任何国界、省界、海岸线；
// · 地点按今天的经纬度落点（等距圆柱投影，与 tools/build-map.py 一致），古地名大字、今地名小字；
// · 选一位诗人：按时间顺序用虚线连起停留地，朱印编号；点地点看年份、经历与在那里写的诗，点诗名打开这首诗；
// · 总览：八位诗人到过的地方都标出来，点一个地点看谁在那里写过什么。
// 颜色全部取页面的 CSS 变量，纸面主题（含夜读）自动适配；文字经 ctx.disp 做简繁转换。
const NS = "http://www.w3.org/2000/svg";
const ORDER = ["李白", "杜甫", "苏轼", "白居易", "王维", "陆游", "辛弃疾", "李清照"];
export const POETS = ORDER;

let D = null, R = null, ctx = null, root = null, sel = { poet: "", place: "" }, lastFocus = null;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const T = (s) => esc(ctx.disp(String(s || "")));
const yr = (y) => (y.length > 1 && y[1] !== y[0] ? `${y[0]}—${y[1]}` : `${y[0]}`);
function age(poet, y) {
  const b = D.poets[poet].b;
  const a0 = y[0] - b, a1 = (y[1] || y[0]) - b;
  if (a0 < 1) return a1 > 1 ? `出生—${a1} 岁` : "出生";
  return a1 !== a0 ? `约 ${a0}—${a1} 岁` : `约 ${a0} 岁`;
}

async function loadData() {
  if (D && R) return;
  const [d, r] = await Promise.all([
    fetch("data/footprints.json" + ctx.VQ).then((x) => { if (!x.ok) throw new Error("footprints"); return x.json(); }),
    fetch("data/rivers.json" + ctx.VQ).then((x) => { if (!x.ok) throw new Error("rivers"); return x.json(); }),
  ]);
  D = d; R = r;
  const { lng0, lat1, k, s } = R.proj;
  for (const p of Object.values(D.places)) { p.x = (p.lng - lng0) * k * s; p.y = (lat1 - p.lat) * s; }
}

function build() {
  root = document.createElement("aside");
  root.className = "mapv"; root.id = "mapv"; root.tabIndex = -1;
  root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-labelledby", "mvTitle");
  root.innerHTML = `
    <header class="mv-head">
      <h2 id="mvTitle">诗人足迹</h2>
      <button type="button" class="btn text mv-close" data-mv-close>关闭</button>
    </header>
    <div class="mv-chips chips" role="group" aria-label="选诗人"></div>
    <div class="mv-main">
      <div class="mv-map"><svg class="mv-svg" role="img" aria-label="山河示意图"></svg></div>
      <div class="mv-side">
        <div class="mv-card" id="mvCard" aria-live="polite"></div>
        <ol class="mv-list" id="mvList"></ol>
        <p class="mv-credit">山河为写意示意，只画主要河湖，不含任何疆界；地点按今城区的近似经纬度落点，年份多为约数。河湖数据：<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>（公有领域），经简化。</p>
      </div>
    </div>`;
  document.body.appendChild(root);
  root.addEventListener("click", onClick);
  root.querySelector(".mv-svg").addEventListener("click", onMapTap);
  root.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  let rz;
  window.addEventListener("resize", () => { if (root.hidden) return; clearTimeout(rz); rz = setTimeout(draw, 120); });
}

export async function open(c, opts = {}) {
  ctx = c;
  await loadData();
  if (!root) build();
  lastFocus = document.activeElement;
  sel = { poet: opts.poet && D.poets[opts.poet] ? opts.poet : "", place: opts.place || "" };
  root.hidden = false;
  document.body.classList.add("map-open");
  render();
  root.focus({ preventScroll: true });
}
export function close() {
  if (!root || root.hidden) return;
  root.hidden = true;
  document.body.classList.remove("map-open");
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
export const isOpen = () => !!(root && !root.hidden);
/** 简繁切换后重画文字 */
export function refresh() { if (isOpen()) render(); }

function render() {
  const chips = [["", "总览"], ...ORDER.map((n) => [n, n])];
  root.querySelector(".mv-chips").innerHTML = chips.map(([k, l]) => `<button type="button" class="chip" data-mv-poet="${esc(k)}" aria-pressed="${sel.poet === k}">${T(l)}</button>`).join("");
  draw();
  drawCard();
  drawList();
}

/* ---------------- 地图 ---------------- */
function stopsOf(poet) { return D.poets[poet].stops; }
function placesShown() {
  if (sel.poet) return [...new Set(stopsOf(sel.poet).map((s) => s.p))];
  return Object.keys(D.places);
}
function poemsAt(place) {
  const out = [];
  for (const n of ORDER) stopsOf(n).forEach((s, si) => { if (s.p === place) out.push({ poet: n, s, si }); });
  return out;
}

function viewBox(svg, ids) {
  const W = svg.clientWidth || 360, H = svg.clientHeight || 400;
  const xs = ids.map((i) => D.places[i].x), ys = ids.map((i) => D.places[i].y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = 70;
  x0 -= pad; x1 += pad * 1.6; y0 -= pad; y1 += pad;       // 右边多留一点给地名
  let w = Math.max(x1 - x0, 420), h = Math.max(y1 - y0, 420);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const a = W / H;
  if (w / h < a) w = h * a; else h = w / a;
  return { x: cx - w / 2, y: cy - h / 2, w, h, u: w / W };
}

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

let geom = null;     // 当前画面：{ vb, pts: [{id, x, y}] }
function draw() {
  const svg = root.querySelector(".mv-svg");
  const ids = placesShown();
  const vb = viewBox(svg, ids);
  const u = vb.u;
  svg.setAttribute("viewBox", `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`);
  svg.innerHTML = "";
  const g0 = el("g", { class: "mv-shan" }, svg);
  // 湖：淡墨晕
  R.lakes.forEach((l) => { el("path", { d: l.d, class: "mv-lake" }, g0); });
  // 河：墨线，粗细分三等（不随缩放变粗）
  R.rivers.forEach((r) => { el("path", { d: r.d, class: "mv-river r" + r.r }, g0); });
  // 名山：几笔小山
  R.hills.forEach((h) => {
    const s = 9 * u;
    el("path", { d: `M${h.x - s * 1.3},${h.y + s * .5} L${h.x - s * .35},${h.y - s * .7} L${h.x + s * .15},${h.y - s * .05} L${h.x + s * .55},${h.y - s * .45} L${h.x + s * 1.3},${h.y + s * .5}`, class: "mv-hill" }, g0);
    const t = el("text", { x: h.x, y: h.y + s * 1.9, class: "mv-hill-t", "font-size": (10 * u).toFixed(2) }, g0);
    t.textContent = ctx.disp(h.n);
  });
  R.rivers.forEach((r) => {
    if (!r.lab) return;
    const t = el("text", { x: r.lab[0] + 6 * u, y: r.lab[1] - 6 * u, class: "mv-river-t", "font-size": (r.r >= 3 ? 13 : 11) * u }, g0);
    t.textContent = ctx.disp(r.n);
  });
  R.lakes.forEach((l) => {
    const t = el("text", { x: l.c[0], y: l.c[1] + 4 * u, class: "mv-river-t mv-lake-t", "font-size": 10 * u }, g0);
    t.textContent = ctx.disp(l.n);
  });

  const g = el("g", { class: "mv-marks" }, svg);
  const boxes = [];
  const overlaps = (b) => boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  const pts = [];
  if (sel.poet) {
    const stops = stopsOf(sel.poet);
    // 路线：按时间顺序连起来，轻轻弯一点的墨色虚线
    const seq = stops.map((s) => s.p).filter((p, i, a) => i === 0 || p !== a[i - 1]);
    let d = "";
    seq.forEach((id, i) => {
      const p = D.places[id];
      if (!i) { d += `M${p.x.toFixed(1)},${p.y.toFixed(1)}`; return; }
      const q = D.places[seq[i - 1]];
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, dx = p.x - q.x, dy = p.y - q.y;
      const k = 0.14;
      d += ` Q${(mx - dy * k).toFixed(1)},${(my + dx * k).toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    });
    el("path", { d, class: "mv-route" }, g);
    // 每个地点一方朱印：写上在这里的第几站（多次到访如「4·9」）
    const nums = new Map();
    stops.forEach((s, i) => { if (!nums.has(s.p)) nums.set(s.p, []); nums.get(s.p).push(i + 1); });
    const order = [...nums.keys()].sort((a, b) => nums.get(a)[0] - nums.get(b)[0]);
    const S = 19 * u;
    for (const id of order) {
      const p = D.places[id];
      const label = nums.get(id).join("·");
      const w = Math.max(S, (label.length * 7.2 + 8) * u);
      const gg = el("g", { class: "mv-seal" + (sel.place === id ? " on" : ""), "data-place": id }, g);
      el("rect", { x: p.x - w / 2, y: p.y - S / 2, width: w, height: S, rx: 3.5 * u }, gg);
      const t = el("text", { x: p.x, y: p.y + 4.2 * u, "font-size": (11.5 * u).toFixed(2) }, gg);
      t.textContent = label;
      boxes.push({ x: p.x - w / 2, y: p.y - S / 2, w, h: S });
      pts.push({ id, x: p.x, y: p.y });
    }
    labels(g, order, (id) => { const s = stops.find((x) => x.p === id && x.label); return s ? s.label : D.places[id].n; }, u, S / 2 + 4 * u, boxes, overlaps);
  } else {
    // 总览：点的大小按在这里写的诗的多少
    const ids = Object.keys(D.places);
    const count = (id) => poemsAt(id).reduce((n, x) => n + (x.s.poems || []).length, 0) + poemsAt(id).length * 0.2;
    const sorted = ids.sort((a, b) => count(b) - count(a));
    for (const id of sorted) {
      const p = D.places[id];
      const r = (3.6 + Math.min(4.5, count(id) * 0.7)) * u;
      const c = el("circle", { cx: p.x, cy: p.y, r, class: "mv-dot" + (sel.place === id ? " on" : ""), "data-place": id }, g);
      void c;
      boxes.push({ x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r });
      pts.push({ id, x: p.x, y: p.y });
    }
    labels(g, sorted, (id) => D.places[id].n, u, 8 * u, boxes, overlaps);
  }
  geom = { vb, pts };
}

// 地名：古名大字 + 今名小字；依次试右、左、上、下，放不下就不写（地点仍可点，列表里也有）
function labels(g, ids, nameOf, u, gap, boxes, overlaps) {
  const fs = 13.5 * u, fm = 10.5 * u;
  for (const id of ids) {
    const p = D.places[id];
    const n = ctx.disp(nameOf(id)), m = p.m && nameOf(id) !== p.m ? ctx.disp(p.m) : "";
    const w = Array.from(n).length * fs + (m ? Array.from(m).length * fm + 4 * u : 0), h = fs * 1.15;
    const cands = [
      { x: p.x + gap, y: p.y - h / 2, a: "start" },
      { x: p.x - gap - w, y: p.y - h / 2, a: "end" },
      { x: p.x - w / 2, y: p.y - gap - h, a: "middle" },
      { x: p.x - w / 2, y: p.y + gap, a: "middle" },
    ];
    const c = cands.find((b) => !overlaps({ x: b.x, y: b.y, w, h }));
    if (!c) continue;
    boxes.push({ x: c.x, y: c.y, w, h });
    const t = el("text", { x: c.x, y: c.y + h * 0.82, class: "mv-name" + (sel.place === id ? " on" : ""), "font-size": fs.toFixed(2), "data-place": id }, g);
    const a = el("tspan", {}, t); a.textContent = n;
    if (m) { const b = el("tspan", { class: "mv-modern", "font-size": fm.toFixed(2), dx: (4 * u).toFixed(2) }, t); b.textContent = m; }
  }
}

function onMapTap(e) {
  if (!geom) return;
  const svg = e.currentTarget;
  const m = svg.getScreenCTM();
  if (!m) return;
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  const hit = e.target.closest && e.target.closest("[data-place]");
  let id = hit ? hit.getAttribute("data-place") : "";
  if (!id) {
    let best = null;
    for (const p of geom.pts) {
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d < 26 * geom.vb.u && (!best || d < best.d)) best = { d, id: p.id };
    }
    id = best ? best.id : "";
  }
  select(id);
}
function select(id, scroll = true) {
  sel.place = id;
  root.querySelectorAll(".mv-svg [data-place]").forEach((n) => n.classList.toggle("on", n.getAttribute("data-place") === id));
  root.querySelectorAll("#mvList [data-mv-place]").forEach((n) => n.setAttribute("aria-current", String(n.dataset.mvPlace === id)));
  drawCard();
  if (id && scroll) {
    const card = root.querySelector("#mvCard");
    if (window.matchMedia("(max-width: 760px)").matches) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

/* ---------------- 地点卡片与列表 ---------------- */
function poemBtns(poet, s, si) {
  return (s.poems || []).map((p, pi) => p.x
    ? `<span class="mv-poem dis">${T(p.t)}<small>${p.y ? p.y + " · " : ""}文，诗库未收</small></span>`
    : `<button type="button" class="mv-poem" data-mv-open="${esc(poet)}|${si}|${pi}">《${T(p.t)}》<small>${p.y ? p.y : ""}${p.u ? (p.y ? " · " : "") + T(p.u) : ""}</small></button>`).join("");
}
function placeHead(id) {
  const p = D.places[id];
  return `<h3 class="mv-place">${T(p.n)}${p.m ? `<small>今${T(p.m)}</small>` : ""}</h3>`;
}
function drawCard() {
  const card = root.querySelector("#mvCard");
  const id = sel.place;
  if (!id || !D.places[id]) {
    card.innerHTML = sel.poet
      ? `<p class="mv-lead"><b>${T(sel.poet)}</b> ${T(D.poets[sel.poet].b + "—" + D.poets[sel.poet].d)} · ${stopsOf(sel.poet).length} 站，${new Set(stopsOf(sel.poet).map((s) => s.p)).size} 个地方</p><p class="mv-hint">点地图上的朱印，或下面的站名</p>`
      : `<p class="mv-lead">八位诗人到过的 ${Object.keys(D.places).length} 个地方</p><p class="mv-hint">点一个地方，看谁在那里写过什么；点上方的名字看一位诗人的足迹</p>`;
    return;
  }
  if (sel.poet) {
    const list = stopsOf(sel.poet).map((s, si) => ({ s, si })).filter((x) => x.s.p === id);
    if (!list.length) { sel.place = ""; drawCard(); return; }
    card.innerHTML = placeHead(id) + list.map(({ s, si }) => `<div class="mv-stop">
        <p class="mv-y"><span class="mv-no">${si + 1}</span>${s.label && s.label !== D.places[id].n ? T(s.label) + " · " : ""}${yr(s.y)} · ${T(age(sel.poet, s.y))}</p>
        <p class="mv-e">${T(s.e)}</p>
        ${(s.poems || []).length ? `<div class="mv-poems">${poemBtns(sel.poet, s, si)}</div>` : ""}
      </div>`).join("");
  } else {
    const list = poemsAt(id);
    const by = new Map();
    list.forEach((x) => { if (!by.has(x.poet)) by.set(x.poet, []); by.get(x.poet).push(x); });
    card.innerHTML = placeHead(id) + [...by.entries()].map(([poet, xs]) => `<div class="mv-stop">
        <p class="mv-y"><b>${T(poet)}</b>${xs.map((x) => yr(x.s.y)).join("，")}<button type="button" class="btn text mv-go" data-mv-poet="${esc(poet)}" data-mv-keep="${esc(id)}">看足迹</button></p>
        <div class="mv-poems">${xs.map((x) => poemBtns(poet, x.s, x.si)).join("") || `<span class="mv-e">${T(xs[0].s.e)}</span>`}</div>
      </div>`).join("");
  }
}
function drawList() {
  const ol = root.querySelector("#mvList");
  if (sel.poet) {
    ol.className = "mv-list";
    ol.innerHTML = stopsOf(sel.poet).map((s, i) => {
      const p = D.places[s.p];
      return `<li><button type="button" data-mv-place="${esc(s.p)}" aria-current="${sel.place === s.p}"><span class="mv-no">${i + 1}</span><b>${T(s.label || p.n)}</b>${p.m ? `<small>${T(p.m)}</small>` : ""}<i>${yr(s.y)}</i></button></li>`;
    }).join("");
  } else {
    ol.className = "mv-list mv-list-all";
    const ids = Object.keys(D.places).sort((a, b) => poemsAt(b).length - poemsAt(a).length || D.places[b].lat - D.places[a].lat);
    ol.innerHTML = ids.map((id) => {
      const p = D.places[id], who = [...new Set(poemsAt(id).map((x) => x.poet))];
      return `<li><button type="button" data-mv-place="${esc(id)}" aria-current="${sel.place === id}"><b>${T(p.n)}</b>${p.m ? `<small>${T(p.m)}</small>` : ""}<i>${who.map(T).join("、")}</i></button></li>`;
    }).join("");
  }
}

async function onClick(e) {
  if (e.target.closest("[data-mv-close]")) { close(); return; }
  const pc = e.target.closest("[data-mv-poet]");
  if (pc) {
    sel.poet = pc.dataset.mvPoet; sel.place = pc.dataset.mvKeep || "";
    render();
    return;
  }
  const pl = e.target.closest("[data-mv-place]");
  if (pl) { select(pl.dataset.mvPlace); return; }
  const op = e.target.closest("[data-mv-open]");
  if (op) {
    const [poet, si, pi] = op.dataset.mvOpen.split("|");
    const entry = stopsOf(poet)[+si].poems[+pi];
    op.disabled = true;
    try { if (await ctx.openPoem(entry, poet)) close(); } finally { op.disabled = false; }
  }
}
