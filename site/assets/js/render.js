// 把注好音的诗渲染成诗笺 DOM，并按版面自适应字号

const CLOSE_PUNCT = /[，。！？；、：,.!?;:）」』》”’…—]/;
const OPEN_PUNCT = /[（「『《“‘]/;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 一行 → 若干「分句」（句末标点跟着前一句），分句内部不换行
export function splitClauses(cells) {
  const out = [];
  let cur = [];
  cells.forEach((c, i) => {
    if (c.ch === " " || c.ch === "\u3000") { if (cur.length) { out.push(cur); cur = []; } return; }
    if (OPEN_PUNCT.test(c.ch) && cur.length && cur.some((x) => x.han)) { out.push(cur); cur = []; }
    cur.push(c);
    const next = cells[i + 1];
    if (CLOSE_PUNCT.test(c.ch) && !(next && CLOSE_PUNCT.test(next.ch))) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out;
}

let seq = 0;
function cellHTML(c) {
  const i = seq++;
  if (!c.han) return `<span class="pc" aria-hidden="${/\s/.test(c.ch)}"><span class="h">${esc(c.ch)}</span></span>`;
  const cls = ["c", c.fix && !c.ov ? "fix" : "", c.ov ? "ov" : "", c.hl ? "hl" : ""].filter(Boolean).join(" ");
  return `<ruby class="${cls}" data-k="${c.key}" tabindex="-1" style="--i:${i}"><span class="h">${esc(c.ch)}</span><rt>${esc(c.py)}</rt></ruby>`;
}

/**
 * @param {HTMLElement} root  #poemView
 * @param {object} poem       {title, author, dynasty, ...}
 * @param {{title:Array, lines:Array}} ann  annotate() 结果
 * @param {object} view       {mode, pinyin, veil, veiled:Set, today, tag, hi, animate}
 */
export function renderPoem(root, poem, ann, view) {
  seq = 0;
  const titleHTML = ann.title.map((cells) => cells.map(cellHTML).join("")).join("");
  const meta = [poem.dynasty, poem.author].filter(Boolean).map(esc).join('<span class="sep">·</span>');
  const tags = [
    view.today ? '<span class="tag-today" title="今日一诗">今日</span>' : "",
    view.tag ? `<span class="tag-src">${esc(view.tag)}</span>` : "",
    view.hi ? `<span class="tag-fh">飞花令「${esc(view.hi)}」</span>` : "",
  ].join("");
  const body = ann.lines.map((cells, li) => {
    const clauses = splitClauses(cells).map((cl) => `<span class="clause">${cl.map(cellHTML).join("")}</span>`).join("");
    const veiled = view.veil && view.veiled.has(li) ? " veiled" : "";
    return `<p class="line${veiled}" data-li="${li}">${clauses}</p>`;
  }).join("");

  root.className = ["poem", "m-" + view.mode, view.pinyin ? "" : "no-py", view.veil ? "veil" : "", view.animate ? "ink-in" : ""].filter(Boolean).join(" ");
  root.innerHTML = `<div class="poem-scroll">
    <header class="poem-head">
      <div class="tagline">${tags}</div>
      <h1 class="poem-title">${titleHTML}${view.sub ? `<small class="poem-sub">${esc(view.sub)}</small>` : ""}</h1>
      ${meta ? `<p class="poem-meta">${meta}</p>` : ""}
    </header>
    <div class="poem-body">${body}</div>
  </div>`;
  const first = root.querySelector(".poem-body ruby.c");
  if (first) first.tabIndex = 0;
  fit(root, view.mode);
  if (view.animate) setTimeout(() => root.classList.remove("ink-in"), 2600);
}

// 自适应字号：横排按最长分句定宽，竖排按最长分句定高，田字格按格子定宽
export function fit(root, mode) {
  const body = root.querySelector(".poem-body");
  if (!body) return;
  const card = root.closest(".card") || root.parentElement;
  const cs = getComputedStyle(card);
  const availW = card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 4;
  const vw = window.innerWidth, vh = window.innerHeight;
  const mobile = vw <= 760;
  const units = (cells, han, punct) => cells.reduce((s, el) => s + (el.matches("ruby.c") ? han : punct), 0);
  const clauses = [...root.querySelectorAll(".poem-body .clause")].map((c) => [...c.children]);
  const titleCells = [...root.querySelectorAll(".poem-title > ruby, .poem-title > .pc")];
  let size;

  if (mode === "v") {
    const pref = mobile ? 30 : 42;
    const maxLen = Math.max(1, ...clauses.map((c) => units(c, 1.38, 1.0)), units(titleCells, 1.38 * .82, .8) + 2);
    const availH = Math.max(260, Math.min(vh * (mobile ? .6 : .62), 620));
    size = Math.min(pref, availH / maxLen);
  } else if (mode === "g") {
    const pref = mobile ? 28 : 40;
    const maxLen = Math.max(1, ...clauses.map((c) => units(c, 1.5, 1.5)));
    size = Math.min(pref, availW / (maxLen + .2));
  } else {
    const pref = mobile ? 40 : Math.min(48, Math.max(34, vw / 30));
    const maxLen = Math.max(1, ...clauses.map((c) => units(c, 1.38, .72)), units(titleCells, 1.38 * .82, .72 * .82));
    size = Math.min(pref, availW / maxLen);
  }
  size = Math.max(16, Math.floor(size));
  root.style.setProperty("--cs", size + "px");
}
