/* 吟诗 · 诗词 API 配置（普通脚本，页面直接加载，无需构建）
 *
 * 默认使用「诗泉」公共实例 https://poetry.palemoky.com（路径前缀 /api）。
 * 换成自建实例（palemoky/chinese-poetry-api，Docker 默认端口 1279，路径前缀 /api/v1）时，
 * 改下面三项即可：
 *   API_BASE   = "https://poetry.example.com"
 *   API_PREFIX = "/api/v1"
 *   PATHS.search = "/poems/search"   // 自建实例的搜索路径与公共实例不同
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
    types: "/types",
    dynasties: "/dynasties"
  },
  LANG: "zh-Hans",
  TIMEOUT_MS: 12000
};
