/* 吟诗 · 诗词 API 配置（普通脚本，页面直接加载，无需构建）
 *
 * 默认使用「诗泉」公共实例 https://poetry.palemoky.com（路径前缀 /api，搜索为 /api/search）。
 * 公共实例目前（2026-10）只开放：/api/poems/random、/api/search（至少 3 个字）、
 * /api/authors、/api/dynasties、/api/types；/api/poems 会忽略 ?author=。
 * 页面会自动探测这些限制并降级（一两个字时给出课本精选、飞花令、随机一首某人的诗）。
 *
 * 换成自建实例（palemoky/chinese-poetry-api，Docker 默认端口 1279）即可获得
 * 1–2 字搜索（单字倒排索引）与「某位作者的诗」列表，改成：
 *   API_BASE     = "https://poetry.example.com"
 *   API_PREFIX   = "/api/v1"
 *   PATHS.search = "/poems/search"
 *
 * 公共实例限流很严：页面加载时不发任何请求，只有点「随机 / 飞花令 / 搜索 / 筛选」才会访问；
 * 结果会缓存在内存和 localStorage 里。
 */
window.YINSHI_CONFIG = {
  API_BASE: "https://poetry.palemoky.com",
  API_PREFIX: "/api",
  PATHS: {
    random: "/poems/random",
    search: "/search",
    poems: "/poems",
    types: "/types",
    dynasties: "/dynasties"
  },
  LANG: "zh-Hans",
  TIMEOUT_MS: 12000
};
