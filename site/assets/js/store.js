// 本地存储：所有键都带 yinshi: 前缀；存储不可用（隐私模式）时静默降级为内存
const mem = new Map();
const P = "yinshi:";

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(P + key);
    if (raw == null) return mem.has(key) ? mem.get(key) : fallback;
    return JSON.parse(raw);
  } catch {
    return mem.has(key) ? mem.get(key) : fallback;
  }
}

export function set(key, value) {
  mem.set(key, value);
  try { localStorage.setItem(P + key, JSON.stringify(value)); } catch { /* 满了或被禁用 */ }
}

export function del(key) {
  mem.delete(key);
  try { localStorage.removeItem(P + key); } catch { /* ignore */ }
}

// 带过期时间的缓存
export function getFresh(key, maxAgeMs) {
  const v = get(key);
  if (v && typeof v === "object" && "at" in v && Date.now() - v.at < maxAgeMs) return v.data;
  return null;
}
export function setFresh(key, data) { set(key, { at: Date.now(), data }); }

// 简单字符串哈希（读音覆盖按诗文本区分版本）
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
