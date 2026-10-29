// 学习功能：朗读、点词看注释、平仄标注、默写、收藏与背诵打卡（间隔复习）、分类找诗、诗词接龙、相关诗、今日节令。
// 全部在浏览器本地完成：收藏、背诵记录存在 localStorage，不需要账号。
import * as store from "./store.js";

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/;
const hanOnly = (s) => Array.from(String(s || "")).filter((c) => HAN.test(c)).join("");
const PUNCT = /[，。！？；：、,.!?;:]/;
export const DAY = 864e5;

/* ---------------- 日期（按北京时间） ---------------- */
export function todayParts(now = new Date()) {
  const forced = new URL(location.href).searchParams.get("date");      // 测试用：?date=2027-02-06
  const d = forced && /^\d{4}-\d{2}-\d{2}$/.test(forced) ? new Date(forced + "T12:00:00+08:00") : now;
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const [y, m, dd] = f.split("-").map(Number);
  let lunar = null;
  try {
    const parts = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).formatToParts(d);
    const lm = parts.find((p) => p.type === "month"), ld = parts.find((p) => p.type === "day");
    if (lm && ld && !/闰/.test(lm.value)) lunar = { m: parseInt(lm.value, 10), d: parseInt(ld.value, 10) };
  } catch { /* 浏览器不支持农历 */ }
  return { ymd: f, y, m, d: dd, lunar, date: d };
}
const dayNum = (ymd) => Math.floor(Date.parse(ymd + "T00:00:00Z") / DAY);
const ymdOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);

/** 今天对应的节日 / 节气（今日一诗优先选它的诗）：{ name, poems } 或 null */
export function seasonPick(cat, t = todayParts()) {
  if (!cat) return null;
  for (const f of cat.festivals || []) {
    if (f.lunar && t.lunar && t.lunar.m === f.lunar[0] && t.lunar.d >= f.lunar[1] && t.lunar.d < f.lunar[1] + (f.span || 1)) return f;
    if (f.solar) {
      const diff = dayNum(t.ymd) - dayNum(`${t.y}-${String(f.solar[0]).padStart(2, "0")}-${String(f.solar[1]).padStart(2, "0")}`);
      if (diff >= 0 && diff < (f.span || 1)) return f;
    }
  }
  for (const j of cat.jieqi || []) {
    const diff = dayNum(t.ymd) - dayNum(`${t.y}-${String(j.m).padStart(2, "0")}-${String(j.d).padStart(2, "0")}`);
    if (Math.abs(diff) <= 1) return j;      // 节气日期每年前后差一天，前后一天都算
  }
  return null;
}

/* ---------------- 平仄（参考） ---------------- */
// 常见入声字（普通话里多读平声，古诗格律算仄声）
const RU = new Set(Array.from("一七八十石日月出入国竹绿发别不雪节叶绝独落黑立学读识得急屋足菊叔北客色百夕惜积席极湿拾食实熟夺薄鹤寂白乞忆译益亦役疫逸壁碧璧滴敌笛狄的迪嫡籍集辑吉疾即级寂击激鲫戚漆膝析昔息熄锡惜袭习席隔革格阁葛国郭蝈各骨谷鹄忽斛福幅蝠伏服复腹覆蝶跌叠碟谍迭结洁杰截劫捷睫接揭协胁穴学雪薛血削约月阅悦越岳乐药跃钥略掠虐烈裂列猎劣灭蔑捏聂孽蹑业页叶液腋越粤哲折辙浙摄设舌涉说朔烁硕铄勺芍酌着桌捉卓浊拙啄茁琢灼斫作昨凿柞鹊雀确却阙缺榷屈曲麴觉角脚爵掘厥决诀绝倔崛莫寞默墨陌脉麦没末抹沫秣迫泊博搏驳帛舶薄魄拍白百柏伯泽择宅窄摘谪责赜则仄测侧册策色涩瑟啬塞得德特忒勒肋墨贼克刻客赫鹤喝渴壳各阁革割葛隔合核盒涸貉"));
const isZe = (py) => /[ǎěǐǒǔǚàèìòùǜ]/.test(py);

/** 五七言绝句 / 律诗（每句 5 或 7 字、4 或 8 句）才标平仄 */
export function isJinti(lines) {
  const clauses = lines.join("").split(PUNCT).map(hanOnly).filter(Boolean);
  if (![4, 8].includes(clauses.length)) return false;
  const n = clauses[0].length;
  return (n === 5 || n === 7) && clauses.every((c) => c.length === n);
}

/* ---------------- 给注好音的格子加标记：注释词、平仄、默写挖空 ---------------- */
export function decorate(lines, simpLines, { note, pingze, dictation }) {
  lines.forEach((cells, li) => {
    const text = Array.from(simpLines[li] || "");
    if (note && note.ci) {
      for (const w of Object.keys(note.ci)) {
        const W = Array.from(w);
        if (!W.every((c) => HAN.test(c))) continue;
        for (let i = 0; i + W.length <= text.length; i++) {
          if (W.every((c, k) => text[i + k] === c)) for (let k = 0; k < W.length; k++) if (cells[i + k] && !cells[i + k].ci) cells[i + k].ci = w;
        }
      }
    }
    // 普通话一、二声为平，三、四声为仄；常见入声字一律算仄（标作「入」）
    if (pingze) cells.forEach((c, i) => { if (!c.han) return; c.pz = RU.has(text[i]) ? "r" : isZe(c.py) ? "z" : "p"; });
    if (dictation) cells.forEach((c) => { if (dictation.blanks.has(c.key)) { c.blank = true; c.ans = dictation.answers[c.key] || ""; } });
  });
  return lines;
}

/* ---------------- 默写：挖空 ---------------- */
export function makeDictation(ann, ratio = 0.3) {
  const blanks = new Set();
  ann.forEach((cells) => {
    // 每个分句挖 1–2 个连在一起的字
    let clause = [];
    const flush = () => {
      const hs = clause.filter((c) => c.han);
      if (hs.length >= 3) {
        const len = hs.length >= 5 && Math.random() < ratio * 2 ? 2 : 1;
        const st = Math.floor(Math.random() * (hs.length - len + 1));
        for (let k = 0; k < len; k++) blanks.add(hs[st + k].key);
      }
      clause = [];
    };
    cells.forEach((c) => { clause.push(c); if (PUNCT.test(c.ch)) flush(); });
    flush();
  });
  return { blanks, answers: {}, startedAt: Date.now() };
}
export function choicesFor(correct, pool, n = 4) {
  const out = new Set([correct]);
  const arr = Array.from(new Set(Array.from(pool).filter((c) => HAN.test(c) && c !== correct)));
  while (out.size < n && arr.length) out.add(arr.splice(Math.floor(Math.random() * arr.length), 1)[0]);
  return [...out].sort(() => Math.random() - 0.5);
}

/* ---------------- 收藏与背诵（间隔复习 1/2/4/7/15 天） ---------------- */
export const INTERVALS = [1, 2, 4, 7, 15];
const slim = (p) => ({ title: p.title, author: p.author, dynasty: p.dynasty || "", lines: p.lines.slice(), source: p.source === "daily" ? "daily" : "api", dailyIndex: p.dailyIndex, lang: p.lang || "hans" });
export const favs = () => store.get("fav", {});
export function toggleFav(key, p) {
  const f = favs();
  if (f[key]) delete f[key]; else f[key] = { p: slim(p), at: Date.now() };
  store.set("fav", f);
  return !!f[key];
}
export const recites = () => store.get("recite", {});
export function reciteState(key, t = todayParts()) {
  const r = recites()[key];
  if (!r) return { state: "new" };
  if (r.stage >= INTERVALS.length) return { state: "done", r };
  return { state: dayNum(t.ymd) >= dayNum(r.next) ? "due" : "wait", r };
}
/** 打卡：第一次 = 已背；到期时 = 复习一次 */
export function checkIn(key, p, t = todayParts()) {
  const all = recites();
  const r = all[key] || { p: slim(p), stage: -1, log: [] };
  const st = reciteState(key, t).state;
  if (st === "wait" || st === "done") return { changed: false, r };
  r.stage += 1;
  r.log.push(t.ymd);
  r.next = r.stage < INTERVALS.length ? ymdOf(dayNum(t.ymd) + INTERVALS[r.stage]) : "";
  r.p = slim(p);
  all[key] = r;
  store.set("recite", all);
  return { changed: true, r };
}
export function forget(key) { const all = recites(); delete all[key]; store.set("recite", all); }
export function dueList(t = todayParts()) {
  return Object.entries(recites()).filter(([k]) => reciteState(k, t).state === "due").map(([k, r]) => ({ key: k, ...r }));
}

/* ---------------- 朗读（Web Speech API） ---------------- */
const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
let voice = null, voicesP = null;
function scoreVoice(v) {
  let s = 0;
  if (/^zh[-_]CN/i.test(v.lang) || /^cmn/i.test(v.lang)) s += 10;
  else if (/^zh/i.test(v.lang) && !/HK|TW|yue/i.test(v.lang)) s += 6;
  else if (/^zh/i.test(v.lang)) s += 1;
  if (/Xiaoxiao|Xiaoyi|Yunxi|Yunjian|Natural|Online/i.test(v.name)) s += 4;
  if (/Tingting|Ting-Ting|Google|普通话|Mandarin|Huihui|Yaoyao|Kangkang/i.test(v.name)) s += 2;
  if (v.localService) s += 1;
  return s;
}
/** 有没有可用的中文语音（等语音列表加载最多 1.5 秒） */
export function ttsReady() {
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return Promise.resolve(false);
  if (!voicesP) {
    voicesP = new Promise((res) => {
      const pick = () => {
        const vs = synth.getVoices().filter((v) => /^(zh|cmn)/i.test(v.lang));
        if (!vs.length) return false;
        voice = vs.sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
        return true;
      };
      if (pick()) return res(true);
      const t = setTimeout(() => res(pick()), 1500);
      synth.addEventListener && synth.addEventListener("voiceschanged", () => { if (pick()) { clearTimeout(t); res(true); } });
    });
  }
  return voicesP;
}
export const voiceName = () => (voice ? voice.name : "");

let speakSeq = 0, timer = null;
export function stopSpeak() {
  speakSeq++;
  clearInterval(timer); timer = null;
  try { synth && synth.cancel(); } catch { /* ignore */ }
}
export const speaking = () => !!(synth && (synth.speaking || synth.pending));
/**
 * 依次读出若干行；onChar(li, ci) 用来高亮正在读的字（-1 表示结束）。
 * 支持 onboundary 的浏览器按真实位置走，否则按语速估算每个字的时长。
 */
export async function speakLines(lines, { rate = 0.9, loop = false, onChar = () => {}, onEnd = () => {} } = {}) {
  stopSpeak();
  const seq = speakSeq;
  await ttsReady();
  const sayOne = (li) => new Promise((res) => {
    const text = lines[li].text;
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : "zh-CN";
    u.rate = rate;
    let gotBoundary = false;
    const chars = Array.from(text);
    const per = Math.max(140, 300 / rate);
    u.onstart = () => {
      if (seq !== speakSeq) return;
      let i = 0;
      onChar(lines[li].li, 0);
      clearInterval(timer);
      timer = setInterval(() => {
        if (gotBoundary || seq !== speakSeq) { clearInterval(timer); return; }
        i++;
        while (i < chars.length && !HAN.test(chars[i])) i++;
        if (i < chars.length) onChar(lines[li].li, i); else clearInterval(timer);
      }, per);
    };
    u.onboundary = (e) => {
      if (seq !== speakSeq || typeof e.charIndex !== "number") return;
      gotBoundary = true;
      // charIndex 是 UTF-16 下标；诗句都是基本平面的汉字，可直接当字序用
      onChar(lines[li].li, Array.from(text.slice(0, e.charIndex)).length);
    };
    u.onend = u.onerror = () => { clearInterval(timer); res(); };
    synth.speak(u);
  });
  do {
    for (let i = 0; i < lines.length; i++) {
      if (seq !== speakSeq) return;
      await sayOne(i);
      if (seq !== speakSeq) return;
      await new Promise((r) => setTimeout(r, 260));
    }
  } while (loop && seq === speakSeq);
  if (seq === speakSeq) { onChar(-1, -1); onEnd(); }
}

/* ---------------- 相关的诗 ---------------- */
const IMAGERY = Array.from("月春秋雨雪山水江花柳风乡酒夜云舟雁梅鸟");
export function related(cur, daily, cat, n = 4) {
  const keyOf = (d) => d.t + "|" + d.a;
  const tagsOf = (k) => Object.entries((cat && cat.themes) || {}).filter(([, ks]) => ks.includes(k)).map(([t]) => t);
  const curKey = cur.title + "|" + cur.author;
  const curTags = tagsOf(curKey);
  const curText = cur.title + cur.lines.join("");
  return daily.map((d, i) => {
    if (keyOf(d) === curKey || (d.t === cur.title && d.a === cur.author)) return null;
    let s = 0;
    const why = [];
    if (d.a === cur.author) { s += 3; why.push("同一位诗人"); }
    const shared = tagsOf(keyOf(d)).filter((t) => curTags.includes(t));
    if (shared.length) { s += 2 * shared.length; why.push(shared[0]); }
    const text = d.t + d.lines.join("");
    const img = IMAGERY.filter((c) => curText.includes(c) && text.includes(c));
    s += Math.min(img.length, 3) * 0.8;
    if (!why.length && img.length) why.push("都写到「" + img[0] + "」");
    return s >= 1.6 ? { i, s, why: why[0] || "", d } : null;
  }).filter(Boolean).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, n);
}

/* ---------------- 诗词接龙 ---------------- */
export function clausesOf(poems) {
  const out = [];
  for (const p of poems) {
    for (const cl of p.lines.join("").split(PUNCT)) {
      const h = hanOnly(cl);
      if (h.length >= 4 && h.length <= 9) out.push({ text: h, title: p.title, author: p.author });
    }
  }
  const seen = new Set();
  return out.filter((c) => (seen.has(c.text) ? false : seen.add(c.text)));
}
export const lastHan = (s) => { const a = Array.from(hanOnly(s)); return a[a.length - 1] || ""; };
