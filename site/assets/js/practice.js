// 学习列表的「开始练习」（按需载入）：按顺序一首一首练，每首按选好的步骤走一遍——
// 朗读 → 看拼音跟读 → 遮字背诵 → 填空默写；最后自评「已会 / 再练」，再练的排到队尾；全部练完给出小结，可以打卡、
// 也可以把已会的诗放进间隔复习（1、2、4、7、15 天）。只用本机存储。
export const STEPS = {
  read: { name: "朗读", tip: "听一遍朗读，眼睛跟着字走" },
  follow: { name: "跟读", tip: "看着拼音，自己大声读一遍" },
  veil: { name: "背诵", tip: "诗句遮住了：点一句看一眼，再遮回去，试着背出来" },
  dict: { name: "默写", tip: "填空默写：点空格选字，或者自己写" },
};
export const ORDER = ["read", "follow", "veil", "dict"];

let P = null, ctx = null, bar = null;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const active = () => !!P;

export async function start(c, list, { steps, schedule }) {
  ctx = c;
  steps = ORDER.filter((s) => steps.includes(s));
  if (!steps.length || !list.items.length) return;
  P = { id: list.id, name: list.name, queue: list.items.map((it) => ({ it })), i: 0, steps, si: 0, schedule: !!schedule, res: new Map(), total: list.items.length };
  if (!bar) {
    bar = document.createElement("section");
    bar.className = "pbar"; bar.id = "pbar";
    bar.setAttribute("aria-label", "练习");
    document.body.appendChild(bar);
    bar.addEventListener("click", onClick);
    document.addEventListener("yinshi:drawn", () => { if (P && P.steps[P.si] === "dict") paint(); });
  }
  bar.hidden = false;
  document.body.classList.add("practicing");
  await showPoem();
}

async function showPoem() {
  const q = P.queue[P.i];
  P.si = 0;
  await ctx.openItem(q.it);
  enter();
}
function enter() {
  const step = P.steps[P.si];
  ctx.stopSpeak();
  if (step === "read") { ctx.endDict(); ctx.setVeil(false); ctx.setPinyin(true); if (ctx.ttsOk()) ctx.speakAll(); }
  else if (step === "follow") { ctx.endDict(); ctx.setVeil(false); ctx.setPinyin(true); }
  else if (step === "veil") { ctx.endDict(); ctx.setVeil(true); }
  else if (step === "dict") { ctx.setVeil(false); ctx.startDict(); }
  paint();
}

function paint() {
  if (!P) return;
  const T = (s) => esc(ctx.disp(s));
  const q = P.queue[P.i], step = P.steps[P.si], last = P.si === P.steps.length - 1;
  const again = P.queue.length - P.total;
  let tip = STEPS[step].tip, extra = "";
  if (step === "read") {
    if (ctx.ttsOk()) extra = `<button type="button" class="btn ghost" data-pb-replay>▶ 再听一遍</button>`;
    else tip = "这台设备没有中文语音，先自己慢慢读一遍";
  }
  if (step === "dict") {
    const d = ctx.dictStatus();
    if (d && d.done >= d.total) tip = `默写完成：答对 <b>${d.ok}</b> / ${d.total}`;
    else if (d) tip = `${STEPS.dict.tip}（${d.done} / ${d.total}）`;
  }
  const acts = last
    ? `<button type="button" class="btn ghost" data-pb-verdict="again">再练</button><button type="button" class="btn solid" data-pb-verdict="ok">已会</button>`
    : `<button type="button" class="btn solid" data-pb-next>下一步：${STEPS[P.steps[P.si + 1]].name}</button>`;
  bar.innerHTML = `
    <div class="pb-top"><b class="pb-name">${T(P.name)}</b><span class="pb-prog" data-pb-prog>第 ${P.i + 1} / ${P.queue.length} 首${again > 0 ? `<small>含再练 ${again}</small>` : ""}</span>
      <button type="button" class="btn text pb-exit" data-pb-exit>结束</button></div>
    <div class="pb-bar"><i style="width:${Math.round((P.i / P.queue.length) * 100)}%"></i></div>
    <ol class="pb-steps">${P.steps.map((s, i) => `<li class="${i < P.si ? "done" : i === P.si ? "on" : ""}" data-pb-step="${s}">${STEPS[s].name}</li>`).join("")}</ol>
    <div class="pb-row"><p class="pb-tip">${tip}</p><div class="pb-acts">${extra}${acts}</div></div>`;
  void q;
}

function verdict(ok) {
  const q = P.queue[P.i];
  const k = q.it.k;
  const r = P.res.get(k) || { it: q.it, again: 0, score: null, ok: false };
  const d = P.steps.includes("dict") ? ctx.dictStatus() : null;
  if (d && d.done) r.score = [d.ok, d.total];
  r.ok = ok;
  if (!ok) { r.again++; P.queue.push({ it: q.it }); }
  P.res.set(k, r);
  P.i++;
  if (P.i < P.queue.length) showPoem();
  else finish();
}

function finish() {
  const T = (s) => esc(ctx.disp(s));
  ctx.stopSpeak(); ctx.endDict(); ctx.setVeil(false);
  const rows = [...P.res.values()];
  const ok = rows.filter((r) => r.ok).length;
  const html = `
    <h3><span>练习完成</span><small>${T(P.name)}</small></h3>
    <p class="ps-lead">共 ${rows.length} 首，已会 <b>${ok}</b> 首${rows.some((r) => r.again) ? `，再练了 ${rows.reduce((n, r) => n + r.again, 0)} 次` : ""}</p>
    <ol class="ps-list">${rows.map((r) => `<li><b>${T(r.it.p.title)}</b><small>${T(r.it.p.author)}</small><span>${r.score ? `默写 ${r.score[0]}/${r.score[1]}` : ""}</span><em class="${r.ok ? "ok" : ""}">${r.again ? `再练 ${r.again} 次` : ""}${r.ok ? " 已会" : ""}</em></li>`).join("")}</ol>
    <label class="pchk"><input type="checkbox" data-ps-sched ${P.schedule ? "checked" : ""}> 把已会的诗加入背诵复习（1、2、4、7、15 天后提醒）</label>
    <div class="pop-row"><button type="button" class="btn solid" data-ps-done>打卡</button><button type="button" class="btn text" data-ps-close>不打卡，关闭</button></div>`;
  const m = ctx.modal(html, "psum");
  m.onclick = (e) => {
    if (e.target.closest("[data-ps-done]")) {
      const sched = m.querySelector("[data-ps-sched]").checked;
      let n = 0;
      if (sched) rows.filter((r) => r.ok).forEach((r) => { if (ctx.checkIn(r.it.p)) n++; });
      ctx.logPractice(P.id, { n: rows.length, ok, at: Date.now() });
      ctx.toast(`已打卡${sched ? (n ? `，${n} 首加入背诵复习` : "（这些诗已在复习计划里）") : ""}`, 2400);
      teardown(); ctx.closeModal();
    } else if (e.target.closest("[data-ps-close]")) { teardown(); ctx.closeModal(); }
  };
}

export function stop() {
  if (!P) return;
  if (P.res.size) finish(); else teardown();
}
function teardown() {
  P = null;
  if (bar) { bar.hidden = true; bar.innerHTML = ""; }
  document.body.classList.remove("practicing");
  ctx.stopSpeak(); ctx.endDict(); ctx.setVeil(false);
  ctx.onEnd && ctx.onEnd();
}

function onClick(e) {
  if (!P) return;
  if (e.target.closest("[data-pb-exit]")) { stop(); return; }
  if (e.target.closest("[data-pb-replay]")) { ctx.speakAll(); return; }
  if (e.target.closest("[data-pb-next]")) { P.si = Math.min(P.si + 1, P.steps.length - 1); enter(); return; }
  const st = e.target.closest("[data-pb-step]");
  if (st) { const i = P.steps.indexOf(st.dataset.pbStep); if (i >= 0 && i !== P.si) { P.si = i; enter(); } return; }
  const v = e.target.closest("[data-pb-verdict]");
  if (v) verdict(v.dataset.pbVerdict === "ok");
}
