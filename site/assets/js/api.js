// 诗泉 API 客户端
// 公共实例限流很严（连续约 8 次即 429，之后封 IP），所以：
//   · 页面加载不发请求，只在用户操作时调用；
//   · 搜索 / 朝代 / 体裁结果缓存在内存 + localStorage；
//   · 本地节流：20 秒内最多 5 次；遇到 429 冷却 90 秒。
import * as store from "./store.js";

const CFG = Object.assign({
  API_BASE: "https://poetry.palemoky.com",
  API_PREFIX: "/api",
  PATHS: { random: "/poems/random", search: "/search", types: "/types", dynasties: "/dynasties" },
  LANG: "zh-Hans",
  TIMEOUT_MS: 12000,
}, window.YINSHI_CONFIG || {});

const memCache = new Map();
const recent = [];             // 最近请求时间戳
const WINDOW_MS = 20000, MAX_IN_WINDOW = 5, COOLDOWN_MS = 90000;

export class ApiError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

function url(key, params = {}) {
  const path = (CFG.PATHS && CFG.PATHS[key]) || "/" + key;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    (Array.isArray(v) ? v : [v]).forEach((one) => one !== "" && qs.append(k, one));
  }
  if (CFG.LANG) qs.append("lang", CFG.LANG);
  return CFG.API_BASE.replace(/\/$/, "") + CFG.API_PREFIX + path + "?" + qs.toString();
}

export function cooldownLeft() {
  const until = store.get("cooldown", 0);
  return Math.max(0, until - Date.now());
}

async function request(u) {
  const left = cooldownLeft();
  if (left > 0) throw new ApiError("cooldown", `诗库正在歇口气，${Math.ceil(left / 1000)} 秒后再试`);
  const now = Date.now();
  while (recent.length && now - recent[0] > WINDOW_MS) recent.shift();
  if (recent.length >= MAX_IN_WINDOW) throw new ApiError("throttle", "点得有点快，稍等几秒再试");
  recent.push(now);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CFG.TIMEOUT_MS);
  let res;
  try {
    res = await fetch(u, { signal: ctrl.signal, headers: { Accept: "application/json" } });
  } catch (e) {
    throw new ApiError("network", e.name === "AbortError" ? "诗库响应太慢了，稍后再试" : "连不上诗库，请检查网络");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    store.set("cooldown", Date.now() + COOLDOWN_MS);
    throw new ApiError("429", "诗库访问太频繁，先歇一会儿（约一分半）");
  }
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok) {
    const msg = body && body.error && body.error.message;
    throw new ApiError("http", msg ? `诗库返回：${msg}` : `诗库暂时不可用（${res.status}）`);
  }
  return body;
}

// 带缓存的 GET。persistMs > 0 时同时写入 localStorage
async function cached(u, persistMs = 0) {
  if (memCache.has(u)) return memCache.get(u);
  if (persistMs) {
    const hit = store.getFresh("c:" + u, persistMs);
    if (hit) { memCache.set(u, hit); return hit; }
  }
  const body = await request(u);
  memCache.set(u, body);
  if (persistMs) {
    store.setFresh("c:" + u, body);
    pruneCache();
  }
  return body;
}

function pruneCache() {
  // 搜索缓存最多保留 40 条，避免 localStorage 越积越多
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("yinshi:c:") && k.includes(CFG.PATHS.search));
    if (keys.length <= 40) return;
    keys.map((k) => [k, (JSON.parse(localStorage.getItem(k)) || {}).at || 0])
      .sort((a, b) => a[1] - b[1]).slice(0, keys.length - 40)
      .forEach(([k]) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}

const DAY = 864e5;

export async function random(params = {}) {
  const body = await request(url("random", params));   // 随机不缓存
  return body && body.data ? normalize(body.data) : null;
}

export async function search(q, page = 1) {
  const body = await cached(url("search", { q, page }), DAY);
  const list = (body && Array.isArray(body.data) ? body.data : []).map(normalize);
  return { list, hasMore: !!(body && body.pagination && body.pagination.hasMore) };
}

export async function meta(kind) {
  const body = await cached(url(kind), 7 * DAY);
  return (body && Array.isArray(body.data) ? body.data : []).map((x) => x.name).filter(Boolean);
}

export function normalize(p) {
  return {
    id: p.id,
    title: String(p.title || "").replace(/\s+/g, " ").trim(),
    author: (p.author && p.author.name) || "",
    dynasty: (p.dynasty && p.dynasty.name) || "",
    type: (p.type && p.type.name) || "",
    lines: (p.content || []).map((l) => String(l).trim()).filter(Boolean),
    source: "api",
  };
}
