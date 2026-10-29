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
  // ci：有注释的词（虚线下划线）；pz：平仄标注（平 / 仄 / 入）；blank：默写挖空（ok / bad：答对 / 答错）
  const cls = ["c", c.fix && !c.ov ? "fix" : "", c.ov ? "ov" : "", c.hl ? "hl" : "", c.ci ? "ci" : "", c.blank ? "blank" : "", c.blank && c.ans ? (c.ans === c.ch ? "ok" : "bad") : "", c.say ? "say" : ""].filter(Boolean).join(" ");
  const pz = c.pz ? `<i class="pz pz-${c.pz}" aria-hidden="true">${c.pz === "p" ? "—" : "|"}</i>` : "";
  const shown = c.blank ? (c.ans || "\u3000") : c.ch;
  return `<ruby class="${cls}" data-k="${c.key}"${c.ci ? ` data-ci="${esc(c.ci)}"` : ""} tabindex="-1" style="--i:${i}"><span class="h">${esc(shown)}</span><rt>${esc(c.py)}</rt>${pz}</ruby>`;
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
  // 作者名可点：更多这位诗人的诗
  const au = poem.author ? `<button class="meta-au" type="button" data-author="${esc(view.authorKey || poem.author)}" title="更多${esc(poem.author)}的诗" aria-haspopup="true">${esc(poem.author)}</button>` : "";
  const meta = [poem.dynasty ? esc(poem.dynasty) : "", au].filter(Boolean).join('<span class="sep">·</span>');
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

  root.className = ["poem", "m-" + view.mode, view.mode === "v" && view.vdir === "lr" ? "v-lr" : "", view.pinyin ? "" : "no-py", view.veil ? "veil" : "", view.animate ? "ink-in" : "", "fresh"].filter(Boolean).join(" ");
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
  // 新插入的字不需要过渡；两帧之后再打开（点一句显示 / 遮住时才有淡入淡出）
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("fresh")));
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
  // 用户字号（设置里的 小/中/大/特大）：乘在自适应字号上。放大后一句放不下就在句内换行，不裁切
  const scale = parseFloat(root.dataset.fs) || 1;
  let wrap = false;
  if (scale !== 1) {
    size *= scale;
    if (mode !== "v") {
      const unit = mode === "g" ? 1.5 : 1.38;
      const longest = mode === "g" ? Math.max(1, ...clauses.map((c) => units(c, 1.5, 1.5))) + .2
        : Math.max(1, ...clauses.map((c) => units(c, 1.38, .72)));
      size = Math.min(size, availW / (unit * 4 + .8));          // 每行至少放得下四个字
      wrap = size * longest > availW;
      // 标题也可能放不下
      if (!wrap && titleCells.length && size * units(titleCells, 1.38 * .82, .72 * .82) > availW) wrap = true;
    }
  }
  size = Math.max(16, Math.floor(size));
  root.classList.toggle("wrapc", wrap);
  root.style.setProperty("--cs", size + "px");
  if (wrap) {
    // 句内换行时让各行字数均匀（7 字 → 4+3，5 字 → 3+2），标点跟着前一个字，不单独成行
    const g = mode === "g", cellW = g ? 1.5 : 1.38, tail = g ? 0 : .72;
    const per = Math.max(1, Math.floor((availW / size - tail) / cellW));
    const n = Math.max(1, ...clauses.map((c) => (g ? c.length : c.filter((el) => el.matches("ruby.c")).length)));
    const rows = Math.ceil(n / per), even = Math.ceil(n / rows);
    root.style.setProperty("--wrapw", Math.ceil((even * cellW + tail) * size + 2) + "px");
  } else root.style.removeProperty("--wrapw");
}
