// 导出：PNG（按屏幕上的诗笺逐字量位置后画到 canvas）与带拼音的纯文本

const SCALE = 2;

function parseColor(c) {
  const m = String(c).match(/rgba?\(([^)]+)\)/);
  if (!m) return { css: c, a: 1 };
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return { css: c, a: p.length > 3 ? p[3] : 1 };
}

function fontOf(el) {
  const s = getComputedStyle(el);
  return `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
}

function charRects(el) {
  // 逐字取位置（用于朝代作者、标签等普通文字，横竖排通用）
  const out = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const text = n.nodeValue;
    let off = 0;
    for (const ch of Array.from(text)) {
      const r = document.createRange();
      r.setStart(n, off); r.setEnd(n, off + ch.length);
      off += ch.length;
      if (!ch.trim()) continue;
      const rect = r.getBoundingClientRect();
      if (rect.width && rect.height) out.push({ ch, rect, el: n.parentElement });
    }
  }
  return out;
}

// 在屏幕外复制一张完整展开的诗笺来量位置：竖排不再横向滚动（宽度随列数增长），
// 横排 / 田字格高度随内容增长，什么都不会被裁掉
function stageClone(card) {
  const live = card.querySelector(".poem");
  const vertical = live.classList.contains("m-v");
  const box = card.getBoundingClientRect();
  const clone = card.cloneNode(true);
  clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  clone.removeAttribute("id");
  clone.querySelectorAll(".card-gear, .card-note").forEach((el) => el.remove());
  const poem = clone.querySelector(".poem");
  poem.classList.remove("ink-in");
  Object.assign(clone.style, {
    position: "fixed", left: "-100000px", top: "0", margin: "0", minHeight: "0",
    maxWidth: "none", animation: "none", transition: "none",
    width: vertical ? "max-content" : box.width + "px",
    minWidth: box.width + "px",
  });
  if (vertical) {
    const sc = poem.querySelector(".poem-scroll");
    Object.assign(sc.style, { overflow: "visible", maxWidth: "none" });
    poem.style.width = "max-content";
  }
  document.body.appendChild(clone);
  return clone;
}

function safeScale(W, H) {
  // 浏览器 canvas 单边约 32767px、面积约 2.68 亿像素
  return Math.max(.5, Math.min(SCALE, 32000 / W, 32000 / H, Math.sqrt(2.5e8 / (W * H))));
}

export async function cardToPNG(liveCard) {
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }
  const card = stageClone(liveCard);
  try { return await paint(card); } finally { card.remove(); }
}

async function paint(card) {
  const poem = card.querySelector(".poem");
  const vertical = poem.classList.contains("m-v");
  const grid = poem.classList.contains("m-g");
  const box = card.getBoundingClientRect();
  const sigH = 54;
  // 实际内容可能超出卡片盒（保险起见再量一次所有字）
  let right = box.right, bottom = box.bottom;
  card.querySelectorAll(".h, rt, .poem-meta, .tagline").forEach((el) => {
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
    right = Math.max(right, r.right + 24); bottom = Math.max(bottom, r.bottom + 24);
  });
  const W = Math.ceil(right - box.left), H = Math.ceil(bottom - box.top) + sigH;
  const S = safeScale(W, H);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * S); canvas.height = Math.round(H * S);
  const ctx = canvas.getContext("2d");
  ctx.scale(S, S);
  const X = (r) => r.left - box.left, Y = (r) => r.top - box.top;

  // 纸
  ctx.fillStyle = "#fbf8f1"; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, 0, 10, W / 2, 0, Math.max(W, H) * .7);
  g.addColorStop(0, "rgba(255,255,255,.7)"); g.addColorStop(1, "rgba(240,232,216,.5)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // 细微纤维
  ctx.save(); ctx.globalAlpha = .035; ctx.fillStyle = "#5a4630";
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < W * H / 60; i++) ctx.fillRect(rnd() * W, rnd() * H, rnd() * 1.6, rnd() * 1.6);
  ctx.restore();
  ctx.strokeStyle = "rgba(212,199,176,.7)"; ctx.lineWidth = 1;
  ctx.strokeRect(12.5, 12.5, W - 25, H - 25);

  ctx.textAlign = "center"; ctx.textBaseline = "middle";

  // 田字格
  if (grid) {
    const lineC = "#d79a90", soft = "rgba(215,154,144,.6)";
    // 拼音四线三格：只画在汉字上，标点格没有（与页面一致）
    poem.querySelectorAll(".poem-body ruby.c rt").forEach((el) => {
      const r = el.getBoundingClientRect();
      const x = X(r), y = Y(r), w = r.width, hh = r.height;
      ctx.strokeStyle = lineC; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, hh - 1);
      ctx.strokeStyle = soft;
      [1 / 3, 2 / 3].forEach((f) => { ctx.beginPath(); ctx.moveTo(x, y + hh * f); ctx.lineTo(x + w, y + hh * f); ctx.stroke(); });
    });
    poem.querySelectorAll(".poem-body .h").forEach((el) => {
      const r = el.getBoundingClientRect(); const x = X(r), y = Y(r);
      ctx.strokeStyle = lineC; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, r.width - 1, r.height - 1);
      ctx.save(); ctx.strokeStyle = soft; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x + r.width / 2, y); ctx.lineTo(x + r.width / 2, y + r.height);
      ctx.moveTo(x, y + r.height / 2); ctx.lineTo(x + r.width, y + r.height / 2); ctx.stroke(); ctx.restore();
    });
  }

  // 汉字与标点
  poem.querySelectorAll(".h").forEach((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (+s.opacity === 0) return;
    ctx.font = fontOf(el); ctx.fillStyle = s.color;
    const size = parseFloat(s.fontSize);
    let cx = X(r) + r.width / 2, cy = Y(r) + r.height / 2;
    if (el.parentElement.classList.contains("pc")) {
      if (vertical) { cx = X(r) + r.width / 2 + size * .3; cy = Y(r) + size * .3; }
      else if (grid && el.firstChild) {
        // 按页面上标点字形实际所在的位置画（各字体的标点字面位置不同，用固定偏移会压到格线）
        const rg = document.createRange(); rg.selectNodeContents(el); const t = rg.getBoundingClientRect();
        cx = X(t) + t.width / 2; cy = Y(t) + t.height / 2;
      }
      else { cx = X(r) + size * .5; }
    }
    ctx.fillText(el.textContent, cx, cy);
  });

  // 拼音
  poem.querySelectorAll("rt").forEach((el) => {
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || parseColor(s.color).a === 0 || !el.textContent) return;
    const r = el.getBoundingClientRect();
    ctx.font = fontOf(el); ctx.fillStyle = s.color;
    const cx = X(r) + r.width / 2, cy = Y(r) + r.height / 2;
    if (vertical) {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 2); ctx.fillText(el.textContent, 0, 0); ctx.restore();
    } else ctx.fillText(el.textContent, cx, cy + 1);
  });

  // 朝代作者、标签
  poem.querySelectorAll(".poem-meta, .tag-src, .tag-fh, .tag-today").forEach((el) => {
    const s = getComputedStyle(el);
    if (el.classList.contains("tag-today")) {
      const r = el.getBoundingClientRect();
      ctx.save(); ctx.strokeStyle = s.color; ctx.lineWidth = 1.5;
      ctx.strokeRect(X(r) + .75, Y(r) + .75, r.width - 1.5, r.height - 1.5); ctx.restore();
    }
    charRects(el).forEach(({ ch, rect, el: owner }) => {
      const os = getComputedStyle(owner);
      ctx.font = fontOf(owner); ctx.fillStyle = os.color;
      ctx.fillText(ch, X(rect) + rect.width / 2, Y(rect) + rect.height / 2);
    });
  });

  // 落款：小印 + 吟诗
  const sx = W - 40 - 26, sy = H - sigH - 6;
  ctx.save();
  ctx.fillStyle = "#b5352a"; roundRect(ctx, sx, sy, 26, 26, 4); ctx.fill();
  ctx.strokeStyle = "rgba(251,241,234,.8)"; ctx.lineWidth = 1; roundRect(ctx, sx + 2.5, sy + 2.5, 21, 21, 2.5); ctx.stroke();
  const han = getComputedStyle(poem).getPropertyValue("--han").trim() || "serif";
  ctx.fillStyle = "#fbf1ea"; ctx.font = `16px ${han}`; ctx.fillText("吟", sx + 13, sy + 14);
  ctx.textAlign = "right"; ctx.fillStyle = "#7a6f62"; ctx.font = `13px ${han}`;
  ctx.fillText("吟诗 · 古诗拼音", sx - 10, sy + 14);
  ctx.restore();

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// 带拼音文本：每行先拼音、后汉字
export function poemToText(poem, ann) {
  const pyLine = (cells) => {
    const parts = [];
    cells.forEach((c) => {
      if (c.han) parts.push(c.py);
      else if (parts.length && c.ch.trim()) parts[parts.length - 1] += c.ch;
    });
    return parts.join(" ");
  };
  const hanLine = (cells) => cells.map((c) => c.ch).join("");
  const out = [];
  ann.title.forEach((cells) => { out.push(pyLine(cells)); out.push(hanLine(cells)); });
  out.push([poem.dynasty, poem.author].filter(Boolean).join(" · "));
  out.push("");
  ann.lines.forEach((cells) => { out.push(pyLine(cells)); out.push(hanLine(cells)); out.push(""); });
  out.push("—— 吟诗");
  return out.join("\n");
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* 回退 */ }
  const ta = document.createElement("textarea");
  ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove(); return ok;
}
