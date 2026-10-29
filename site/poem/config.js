/* 吟诗 · 诗词 API 配置（普通脚本，页面直接加载，无需构建）
 *
 * 浏览器直接请求公开接口，不经任何中转：
 *   主诗库  https://poetry-api.snowtraces.com/v1 —— snowtraces/poetry-source（Cloudflare Workers + D1，约 53 万首，简体）。
 *           搜索诗名 / 诗人（至少 2 个字）、按诗人列出全部作品、随机（可按朝代 / 诗词曲 / 诗人筛选）。
 *           按 IP 限流每 60 秒 60 次，客户端排队节流并在 429 时按 Retry-After 冷却。
 *   备用    https://poetry.palemoky.com/api —— 诗泉 palemoky/chinese-poetry-api 公共实例。
 *           主诗库连不上 / 繁忙时用于随机与 3 字以上搜索；单字（如「月」）与飞花令从这里随机抽含该字的诗。
 * 页面加载时不发任何请求；结果缓存在内存和 localStorage 里。繁体由页面用 OpenCC 本地转换。
 *
 * 换成自建实例只要改 base（poetry-source 的部署方法见其仓库 api/DEPLOY_CLOUDFLARE.md）。
 */
window.YINSHI_CONFIG = {
  PRIMARY: {
    name: "snowtraces",
    base: "https://poetry-api.snowtraces.com/v1",
    limits: [{ windowMs: 60000, max: 50 }, { windowMs: 3000, max: 6 }],   // 低于接口的每分钟 60 次
    maxWaitMs: 5000,       // 超出额度时最多排队等这么久
    cooldownMs: 60000,     // 429 且读不到 Retry-After 时歇多久
    timeoutMs: 10000
  },
  FALLBACK: {
    name: "palemoky",
    base: "https://poetry.palemoky.com/api",
    limits: [{ windowMs: 20000, max: 5 }],
    maxWaitMs: 4000,
    cooldownMs: 90000,
    timeoutMs: 12000,
    minSearch: 3           // 备用诗库的搜索至少要 3 个字
  },
  PAGE_SIZE: 30,           // 搜索每页条数（接口上限 50）
  AUTHOR_PAGE_SIZE: 50,    // 「某位诗人的诗」每次加载条数
  CHAR_SAMPLES: 3          // 单字搜索时随机抽几首含这个字的诗
};
