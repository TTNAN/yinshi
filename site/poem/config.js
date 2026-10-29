/* 吟诗 · 诗词 API 配置（普通脚本，页面直接加载，无需构建）
 *
 * 诗词数据来自「诗泉」（palemoky/chinese-poetry-api）的公共实例，按顺序使用：
 *   1. https://poetry.llmaix.com/api/v1  —— 新版接口：单字也能搜、可按作者搜索（type=author），
 *      随机支持 author / dynasty / type / char；按 IP 限流约每秒 10 次。
 *   2. https://poetry.palemoky.com/api   —— 备用：主实例连不上（网络错误或 5xx）时自动改用。
 *      它的搜索至少要 3 个字，也不能按作者列出诗，限流较严。
 * 页面加载时不发任何请求；结果缓存在内存和 localStorage 里。
 *
 * 换成自建实例（Docker 默认端口 1279）只要把第一项的 base 改成你的地址。
 */
window.YINSHI_CONFIG = {
  SOURCES: [
    {
      name: "llmaix",
      base: "https://poetry.llmaix.com/api/v1",
      paths: { random: "/poems/random", search: "/poems/search", types: "/types", dynasties: "/dynasties" },
      searchTypes: true,          // 支持 type=all|title|content|author
      minSearch: 1,               // 最短搜索字数
      randomWrapped: false,       // 随机接口直接返回一首诗（没有外层 data）
      rate: { windowMs: 1000, max: 4 },
      cooldownMs: 15000,
      timeoutMs: 8000
    },
    {
      name: "palemoky",
      base: "https://poetry.palemoky.com/api",
      paths: { random: "/poems/random", search: "/search", types: "/types", dynasties: "/dynasties" },
      searchTypes: false,
      minSearch: 3,
      randomWrapped: true,
      rate: { windowMs: 20000, max: 5 },
      cooldownMs: 90000,
      timeoutMs: 12000
    }
  ],
  PAGE_SIZE: 30,          // 搜索每页条数（接口上限 100）
  AUTHOR_PAGE_SIZE: 50    // 「某位诗人的诗」每次加载条数
};
