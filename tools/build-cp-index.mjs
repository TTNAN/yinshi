#!/usr/bin/env node
// 生成「全唐诗 / 全宋诗」索引（chinese-poetry 数据集，MIT）：只在本地运行一次，产物提交到 site/data/cp/。
//   node tools/build-cp-index.mjs            （需要 node 18+；会下载 npm 包 chinese-poetry@2.0.1，约 85 MB，缓存在 tools/.cache/）
// 页面运行时只读这里生成的小索引；诗的正文由浏览器直接从公共 CDN（unpkg，备用 raw.githubusercontent.com）按 1000 首一块取回。
// 产物：
//   site/data/cp/index.json      诗人 → 作品编号区间、诗数；繁→简单字表；唐诗三百首的编号
//   site/data/cp/featured.json   唐诗三百首（简体全文，让「李白的诗」第一页、诗名搜索不用先下载大块数据）
//   site/data/cp/t/NN.txt        诗名索引（按诗名前两个字分 64 片，供「诗名开头」检索）：唐诗全部 + 宋诗名家
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PKG = "chinese-poetry", VER = "2.0.1";
const COMMIT = "b8594f81a89752241442f2ce267d6f66f96704ee";   // 同一份数据在 GitHub 上的提交（备用 CDN 用），已逐文件比对一致
const CACHE = path.join(HERE, ".cache");
const OUT = path.join(ROOT, "site", "data", "cp");
const SHARDS = 64;
const STRIDE = 1024;              // 每块（一个文件）占 1024 个编号：文件里不总是正好 1000 首（有 997–1003 首的）
const SONG_BASE = 60000;          // 唐诗编号 = 块号 × 1024 + 块内序号；宋诗编号 = 60000 + 块号 × 1024 + 块内序号
const SONG_TITLE_MIN = 900;       // 宋诗诗名索引：收录名家 + 作品 ≥ 900 首的诗人
const SONG_FAMOUS = "苏轼 王安石 陆游 杨万里 范成大 黄庭坚 欧阳修 朱熹 梅尧臣 苏辙 秦观 李清照 辛弃疾 文天祥 林逋 晏殊 程颢 叶绍翁 曾几 赵师秀 翁卷 卢梅坡 雷震 释志南 林升 郑思肖 陈与义 范仲淹 司马光 曾巩 苏舜钦 王禹偁 晏几道 周邦彦 岳飞 陈师道 张耒 晁补之 刘克庄 戴复古 姜夔 吕本中 道潜 寇准 邵雍 王令 张俞 杨朴 李觏 华岳 高翥 方岳 刘过 张孝祥 汪藻 乐雷发".split(" ");

const opencc = await import(path.join(ROOT, "site/vendor/opencc-js-1.4.2/opencc-full.esm.js"));
const t2s = opencc.Converter({ from: "t", to: "cn" });

// 1. 下载并解包数据
const dir = path.join(CACHE, `${PKG}-${VER}`, "package", "dist", "quantangshi");
if (!fs.existsSync(dir)) {
  fs.mkdirSync(path.join(CACHE, `${PKG}-${VER}`), { recursive: true });
  const tgz = path.join(CACHE, `${PKG}-${VER}.tgz`);
  if (!fs.existsSync(tgz)) execSync(`curl -sSfL -o "${tgz}" https://registry.npmjs.org/${PKG}/-/${PKG}-${VER}.tgz`, { stdio: "inherit" });
  execSync(`tar xzf "${tgz}" -C "${path.join(CACHE, `${PKG}-${VER}`)}" package/dist/quantangshi package/LICENSE`, { stdio: "inherit" });
}
const count = (k) => fs.readdirSync(dir).filter((f) => new RegExp(`^poet\\.${k}\\.\\d+\\.json$`).test(f)).length;
const FILES = { tang: count("tang"), song: count("song") };

const HAN = /[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2ffff}]/u;
const han = (s) => Array.from(String(s || "")).filter((c) => HAN.test(c)).join("");
const normTitle = (t) => String(t || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");

// 2. 读全部诗
const charVotes = new Map();         // 繁体字 → { 简体: 次数 }（按整句转换的结果投票，得到逐字对照表）
function vote(src, dst) {
  const a = Array.from(src), b = Array.from(dst);
  if (a.length !== b.length) return;
  for (let i = 0; i < a.length; i++) {
    let m = charVotes.get(a[i]);
    if (!m) charVotes.set(a[i], (m = new Map()));
    m.set(b[i], (m.get(b[i]) || 0) + 1);
  }
}
const poems = [];   // { id, author, dyn, title, first }
for (const [kind, n] of [["tang", FILES.tang], ["song", FILES.song]]) {
  for (let f = 0; f < n; f++) {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, `poet.${kind}.${f * 1000}.json`), "utf8"));
    arr.forEach((p, i) => {
      const id = (kind === "song" ? SONG_BASE : 0) + f * STRIDE + i;
      const paras = (p.paragraphs || []).map((x) => String(x).trim()).filter(Boolean);
      if (!paras.length) return;
      const title = t2s(String(p.title || "").trim());
      const author = t2s(String(p.author || "").trim()) || "佚名";
      const body = t2s(paras.join("|"));
      vote(p.title || "", title); vote(p.author || "", author); vote(paras.join("|"), body);
      poems.push({ id, author, dyn: kind === "tang" ? "唐" : "宋", title, first: han(body.split("|")[0]).slice(0, 10), head: han(body).slice(0, 16) });
    });
  }
  console.log(kind, "files", n);
}
console.log("poems", poems.length);

// 3. 每位诗人（名字 + 朝代）去重后的编号，压成连续区间
const byAuthor = new Map();
const best = new Map();   // 诗人|正文开头 → 保留的那一首（诗名最短的，如保留「将进酒」而不是「鼓吹曲辞 将进酒」）
for (const p of poems) {
  // 同一首诗常在不同卷里重复收录、诗名写法不同（如「蜀道难」与「相和歌辞 蜀道难」）：按正文开头去重
  const k = p.author + "|" + p.dyn + "|" + p.head;
  const b = best.get(k);
  if (!b) { best.set(k, p); continue; }
  if (normTitle(p.title).length < normTitle(b.title).length) { b.dup = true; best.set(k, p); } else p.dup = true;
}
for (const p of poems) {
  if (p.dup) continue;
  const k = p.author + "|" + p.dyn;
  let a = byAuthor.get(k);
  if (!a) byAuthor.set(k, (a = { name: p.author, dyn: p.dyn, ids: [] }));
  a.ids.push(p.id);
}
const runs = (ids) => {
  const out = [];
  let s = ids[0], prev = ids[0];
  for (let i = 1; i <= ids.length; i++) {
    if (i < ids.length && ids[i] === prev + 1) { prev = ids[i]; continue; }
    out.push([s, prev - s + 1]);
    if (i < ids.length) s = prev = ids[i];
  }
  // 区间编码：起点用相对上一个区间终点的差（36 进制），长度为 1 时省略
  let last = 0;
  return out.map(([st, len]) => { const d = (st - last).toString(36); last = st + len; return len > 1 ? d + "+" + len.toString(36) : d; }).join(",");
};
const authors = [...byAuthor.values()].sort((a, b) => b.ids.length - a.ids.length)
  .map((a) => [a.name, a.dyn === "唐" ? 0 : 1, a.ids.length, runs(a.ids)]);

// 4. 唐诗三百首：找到对应编号，并带简体全文
const tsb = JSON.parse(fs.readFileSync(path.join(dir, "唐诗三百首.json"), "utf8"));
const lookup = new Map(poems.filter((p) => !p.dup).map((p) => [p.author + "|" + p.first, p]));
const featured = [];
const fSeen = new Set();
for (const p of tsb) {
  const author = t2s(p.author || ""), paras = (p.paragraphs || []).map((x) => t2s(String(x).trim())).filter(Boolean);
  if (!paras.length) continue;
  const hit = lookup.get(author + "|" + han(paras[0]).slice(0, 10));
  const title = hit ? hit.title : t2s(p.title || "");
  const k = author + "|" + han(paras.join(""));
  if (fSeen.has(k)) continue;
  fSeen.add(k);
  featured.push({ id: hit ? hit.id : -1, t: title, a: author, d: "唐", l: paras });
}
console.log("featured", featured.length, "matched", featured.filter((x) => x.id >= 0).length);

// 5. 繁 → 简 单字表（按整句转换结果的多数票；与原字相同的不收）
const t2sMap = [];
for (const [c, m] of charVotes) {
  const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  if (best !== c) t2sMap.push(c + best);
}
console.log("t2s pairs", t2sMap.length);

// 6. 诗名索引（按诗名前两个汉字分片；页面里的 shardOf 必须与这里一致）
const shardOf = (two) => { let h = 0; for (const c of two) h = (h * 31 + c.codePointAt(0)) >>> 0; return h % SHARDS; };
const famous = new Set(SONG_FAMOUS);
const songCount = new Map(authors.filter((a) => a[1] === 1).map((a) => [a[0], a[2]]));
const shards = Array.from({ length: SHARDS }, () => []);
let titled = 0;
for (const p of poems) {
  if (p.dup) continue;
  if (p.dyn === "宋" && !famous.has(p.author) && (songCount.get(p.author) || 0) < SONG_TITLE_MIN) continue;
  const t = normTitle(p.title);
  const two = Array.from(han(t)).slice(0, 2).join("");
  if (Array.from(two).length < 2) continue;
  shards[shardOf(two)].push(p.id.toString(36) + "\t" + t);
  titled++;
}
console.log("titled", titled);

// 7. 写出
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "t"), { recursive: true });
const index = {
  v: 2,
  src: { name: "chinese-poetry", license: "MIT", npm: `${PKG}@${VER}`, commit: COMMIT, url: "https://github.com/chinese-poetry/chinese-poetry" },
  files: FILES, songBase: SONG_BASE, stride: STRIDE, shards: SHARDS,
  cdn: [
    `https://unpkg.com/${PKG}@${VER}/dist/quantangshi/`,
    `https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/${COMMIT}/%E5%85%A8%E5%94%90%E8%AF%97/`,
  ],
  t2s: t2sMap.join(""),
  featured: featured.filter((x) => x.id >= 0).map((x) => x.id),
  authors,
};
const w = (f, s) => { fs.writeFileSync(path.join(OUT, f), s); return [f, Buffer.byteLength(s), zlib.gzipSync(s).length]; };
const sizes = [w("index.json", JSON.stringify(index)), w("featured.json", JSON.stringify(featured))];
shards.forEach((s, i) => sizes.push(w(`t/${String(i).padStart(2, "0")}.txt`, s.join("\n"))));
const tot = sizes.reduce((a, s) => [a[0] + s[1], a[1] + s[2]], [0, 0]);
console.log(sizes.slice(0, 4).map((s) => s.join(" ")).join("\n"));
console.log("total bytes", tot[0], "gzip", tot[1]);
