# 吟诗 · 给古诗注上拼音

> 一张宣纸，一首诗，字上带拼音。给孩子读诗、给自己温诗。

吟诗是一个纯静态网页：打开就是「今日一诗」，汉字上方逐字标注带调号的拼音；可以横排、竖排、田字格三种方式读，遮住诗句背诵，玩飞花令，导出图片或打印成 A4。

不需要构建，不需要框架，`site/` 目录直接就是网站。

## 功能

- **今日一诗**：内置 72 首小学必背古诗（统编版课本文本），按日期确定性轮换，首次打开即显示，带「今日」小印。
- **三种排版**
  - 横排：每字一格，拼音在字上方，等宽对齐，长句按分句换行，不会把一句拆开。
  - 竖排：`writing-mode: vertical-rl`，从右往左，拼音在字的右侧，标题与作者自成一列。
  - 田字格：每字配「四线三格」拼音格 + 虚线十字田字格，适合打印描红、默写。
- **显示拼音** 开关：关掉后版面不跳动；田字格里只留空的四线三格，正好用来默写拼音。
- **遮字背诵**：打开后诗句被墨晕遮住，点一句显示 / 再点遮住。
- **改读音**：点任意一字，弹出它的可选读音（来自 pinyin-pro 的多音字表与读音修正表），也可以输入任意拼音（如 `xia2`）。改动按「这一首诗」记在浏览器 localStorage 里。
- **课本读音修正**（默认开）：`site/poem/poem-readings.json` 中 39 条按上下文片段匹配的修正，例如 朝辞白帝 zhāo、千里江陵一日还 huán、少小离家 shào、浑欲不胜簪 shēng。
- **吟诵旧读**（默认关）：石径斜 xiá、鬓毛衰 cuī、一骑 jì 红尘、笼盖四野 yǎ 等传统读法。现行课本已不采用，所以只作可选项。
- **找诗**
  - 顶栏搜索：边打字边查内置课本精选；回车搜整个诗库（诗库搜索至少 3 个字；两个字的作者名会提供「随机一首他的诗」）。
  - 随机：可在「筛选」抽屉里限定朝代、体裁、作者。
  - 飞花令：出一个字，随机来一首含这个字的诗，诗中该字以朱砂色标出。
  - 诗库里的同名诗若与课本文字不同（如《静夜思》作「床前看月光」），卡片下方会出现「改用课本版」。
- **导出**：打印（只打印诗笺，干净 A4）、导出 PNG 图片（按屏幕版式逐字绘制，带落款小印）、复制带拼音文本（每行先拼音后汉字）。
- **手机**：诗笺铺满屏幕，常用操作在底栏；搜索结果和飞花令为底部弹层。
- **键盘**：`/` 搜索，`R` 随机，`Esc` 关闭弹层；诗笺内用方向键在字之间移动，回车改读音。

## 对诗库接口友好

公共诗库（诗泉）限流很严，连续请求会被 429 甚至封 IP，所以：

- 页面加载时 **不发任何 API 请求**（今日一诗来自内置数据）；
- 只有点「随机 / 飞花令 / 回车搜索 / 打开筛选」时才请求；
- 搜索结果缓存 1 天、朝代与体裁缓存 7 天（内存 + localStorage）；
- 本地节流：20 秒内最多 5 次；收到 429 后冷却 90 秒，期间给出提示，并用内置课本诗兜底。

## 部署到 Cloudflare Pages

1. 把仓库推到 GitHub（或直接用 `wrangler pages deploy site`）。
2. Cloudflare Dashboard → Workers & Pages → 创建 → Pages → 连接仓库。
3. 构建设置：
   - Framework preset：`None`
   - Build command：**留空**
   - Build output directory：**`site`**
4. 保存并部署。`site/_headers` 会为字体和拼音引擎加上长期缓存。

其他静态托管（GitHub Pages、Netlify、Nginx）同理：把 `site/` 目录作为网站根目录即可。

> 本地预览需要一个 HTTP 服务（直接双击 `index.html` 时浏览器不允许读取 JSON）：
> `python3 -m http.server -d site 8080` 或 `npx serve site`，然后打开 http://localhost:8080 。

## 切换诗词 API

编辑 `site/poem/config.js`：

```js
window.YINSHI_CONFIG = {
  API_BASE: "https://poetry.palemoky.com",   // 自建实例改成你的域名
  API_PREFIX: "/api",                         // 自建 Docker 实例为 "/api/v1"
  PATHS: {
    random: "/poems/random",
    search: "/search",                        // 自建实例为 "/poems/search"
    types: "/types",
    dynasties: "/dynasties"
  },
  LANG: "zh-Hans",                            // 繁体用 "zh-Hant"
  TIMEOUT_MS: 12000
};
```

自建实例见 [palemoky/chinese-poetry-api](https://github.com/palemoky/chinese-poetry-api)（Docker 默认端口 1279），自建后基本不用担心限流。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `site/index.html` | 页面骨架 |
| `site/assets/css/yinshi.css` | 全部样式（宣纸 / 水墨 / 朱砂；横排 / 竖排 / 田字格；手机；打印） |
| `site/assets/js/main.js` | 应用状态、交互、搜索 / 随机 / 飞花令 |
| `site/assets/js/reading.js` | 注音：pinyin-pro → 课本修正 → 吟诵旧读 → 用户自定义 |
| `site/assets/js/render.js` | 诗笺渲染（`<ruby>` 逐字格）与自适应字号 |
| `site/assets/js/exporter.js` | 导出 PNG（canvas）与带拼音文本 |
| `site/assets/js/api.js` | 诗泉 API 客户端（缓存、节流、429 冷却） |
| `site/assets/js/store.js` | localStorage 封装 |
| `site/poem/config.js` | API 配置 |
| `site/poem/daily-poems.json` | 72 首小学必背（课本文本） |
| `site/poem/poem-readings.json` | 读音修正表（`textbook` 默认开，`recite` 默认关） |
| `site/vendor/pinyin-pro-3.29.5.min.js` | 拼音引擎（npm 原版，未修改） |
| `site/fonts/` | 拼音字体 Noto Serif（拉丁 + 拉丁扩展子集） |
| `tests/e2e.py` | Playwright 无头验收（用 `tests/fixtures/api.json` 模拟诗库，不访问真实接口） |

### 修改读音修正表

`poem-readings.json` 每条形如 `{"p": "[朝]辞白帝", "r": "zhāo", "note": "早发白帝城：早晨"}`：`p` 是带上下文的诗句片段，用 `[ ]` 标出要改的字。只有整段片段原样出现在某一行时才生效，所以上下文越长越安全。改完刷新页面即可。

### 运行测试

```bash
pip install playwright && python3 -m playwright install chromium
python3 tests/e2e.py            # 截图输出到 tests/screens/
```

## 致谢与许可

- 代码：MIT © 2026 Caesar (TTNAN)，见 [LICENSE](LICENSE)。
- 拼音：[pinyin-pro](https://github.com/zh-lx/pinyin-pro)（MIT）。
- 诗词数据：[诗泉 palemoky/chinese-poetry-api](https://github.com/palemoky/chinese-poetry-api)，运行时通过公开 API 获取，仓库不包含其代码。
- 字体：[霞鹜文楷 LXGW WenKai](https://github.com/lxgw/LxgwWenKai)（SIL OFL 1.1，经 jsDelivr 加载）、Noto Serif（SIL OFL 1.1，本地托管）。
- 感谢 [tjsky/pinyin-annotator](https://github.com/tjsky/pinyin-annotator) 带来的灵感——吟诗最初就是从它开始的；现在的版本是独立重写的新项目，不含它的代码。
