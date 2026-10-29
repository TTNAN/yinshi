<p align="center"><img src="site/assets/logo.svg" width="120" alt="吟诗"></p>

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
  - 顶栏搜索：边打字边查内置课本精选；回车搜整个诗库（诗名、诗人，两个字起）。输入 2–4 个字、像诗人名字时，同时按诗人列出作品：结果分成「课本精选」「某某的诗（可一直加载更多）」「诗名与诗句」三节。只输一个字（如「月」）时，列出课本里含这个字的诗，再从备用诗库随机挑几首含这个字的诗，并给出「飞花令」入口。
  - 诗人：诗笺上的作者名可以点，弹出「更多 李白 的诗」「随机一首 李白 的诗」。
  - 随机：可在「筛选」抽屉里限定朝代、体裁、诗人（输入框带候选，下面有常见诗人可一键选）；顶栏「随机」也沿用这些条件。
  - 飞花令：出一个字，随机来一首含这个字的诗，诗中该字以朱砂色标出。
  - 诗库里的同名诗若与课本文字不同（如《静夜思》作「床前看月光」），卡片下方会出现「改用课本版」。
- **导出**：打印（只打印诗笺，干净 A4）、导出 PNG 图片（按屏幕版式逐字绘制，带落款小印）、复制带拼音文本（每行先拼音后汉字）。
- **手机**：诗笺铺满屏幕，常用操作在底栏；搜索结果和飞花令为底部弹层。
- **作者与赏析**：宽屏时诗笺左侧是作者生平（朝代、生卒年、字号、简介、代表作，点代表作直接搜），右侧是这首诗的诗意、情感、创作背景；手机上在诗笺下方，默认收起，点「作者」「赏析」展开。没有赏析的诗只显示作者（主诗库能查到生卒年时补上）。
- **纸面**（设置里）：宣纸（默认）/ 素笺 / 竹简 / 绢本 / 青花 / 夜读（深色）/ 信笺，纹理都是 CSS 与内联 SVG 自绘；还可以「自定义」上传一张背景图——图片在本机缩到 1600px 以内存进浏览器 IndexedDB，**不会上传**，可调遮罩浓淡、换图、移除。导出图片跟随纸面（自定义背景也会画进去），打印始终是白纸黑字。
- **设置**（诗笺右上角）：
  - 字体：一格一种、名字用它自己的字形显示，共 8 种开源字体：仿宋（朱雀仿宋，默认）/ 宋体（思源宋体）/ 楷体（霞鹜文楷）/ 黑体（思源黑体）/ 小薇（站酷小薇）/ 毛笔（马善政楷书）/ 快乐（站酷快乐体）/ 行书（龙藏体）。只加载选中的那一种，并按字分片下载：朱雀仿宋由本站托管（`site/fonts/zhuque-fangsong/`，92 片），霞鹜文楷走 jsDelivr，其余走 `fonts.googleapis.cn`。后四种只收常用简体字，缺字（多为繁体）时退回宋体。以前选过字体的用户保留原来的选择。
  - 字号（小 / 中 / 大 / 特大）、拼音大小（小 / 中 / 大）、行距（紧凑 / 适中 / 宽松）；放大后一句放不下会在句内换行，不裁切。
  - 竖排方向：从右到左（传统）/ 从左到右；在横排、田字格下点它会直接切到竖排。
  - 简繁：简体 / 繁體。诗库返回简体，页面用 OpenCC 转成繁体（备用诗库直接请求 `lang=zh-Hant`）；注音仍按简体计算（课本读音修正、自定义读音照常生效），再逐字换上繁体字形。导出图片、打印、复制文本都用当前字形。
  - 以上都记在浏览器里，导出图片和打印同样生效；「恢复默认」一键还原。
- **键盘**：`/` 搜索，`R` 随机，`Esc` 关闭弹层；诗笺内用方向键在字之间移动，回车改读音。

## 诗库来源与接口友好

浏览器直接请求两个公开接口（不经任何中转）：

1. **主诗库** [snowtraces/poetry-source](https://github.com/snowtraces/poetry-source) 的公共接口 `https://poetry-api.snowtraces.com/v1`（Cloudflare Workers + D1，免 Key）：按诗名 / 诗人搜索（至少 2 个字，游标分页）、`/authors?q=` 由诗人名找到 id 后用 `/authors/:id/works` 列出全部作品、`/works/random` 随机（可按朝代、诗 / 词 / 曲、诗人筛选）。按 IP 限流每 60 秒 60 次。
2. **备用** 诗泉（[palemoky/chinese-poetry-api](https://github.com/palemoky/chinese-poetry-api)）的公共实例 [poetry.palemoky.com](https://poetry.palemoky.com)（`/api`）：主诗库连不上、5xx 或 429 时用于随机和 3 字以上搜索；单字搜索、飞花令（按字随机）也走这里。

对接口尽量友好：

- 页面加载时 **不发任何 API 请求**（今日一诗来自内置数据）；
- 只有点「随机 / 飞花令 / 回车搜索 / 打开筛选」时才请求；
- 搜索与诗人作品缓存 1 天、诗人 id 缓存 30 天、朝代缓存 7 天（内存 + localStorage）；
- 客户端排队节流：主诗库每分钟最多 50 次、3 秒内最多 6 次（低于接口的 60 次 / 分钟），备用 20 秒最多 5 次；收到 429 时按 `Retry-After`（读不到时 60 秒）冷却，期间给出提示并用内置课本诗兜底。

3. **全唐诗 / 全宋诗** [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（MIT）：主诗库几乎没有唐诗、宋诗（「李白」只有 9 首词），所以「某某的诗」、随机某位诗人、诗名搜索都会并入这份数据（唐诗约 5.7 万首、宋诗约 25 万首；李白 1098 首、杜甫 1470 首、王维 394 首、苏轼诗 2824 首，均为去重后）。本站只托管 `tools/build-cp-index.mjs` 生成的小索引 `site/data/cp/`（诗人 → 作品编号约 140 KB gzip、按诗名前两字分 64 片的诗名索引、唐诗三百首全文），诗的正文由浏览器按「1000 首一块」直接从 [unpkg](https://unpkg.com/chinese-poetry@2.0.1/)（npm 包 chinese-poetry@2.0.1）取，连不上时改用 raw.githubusercontent.com 上同一份数据的固定提交。原数据是繁体，页面用索引里的繁→简单字表转成简体显示（繁體模式照常转回）。


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

编辑 `site/poem/config.js`：`PRIMARY.base` 是主诗库地址（poetry-source 可自建，见其仓库 `api/DEPLOY_CLOUDFLARE.md`），`FALLBACK.base` 是诗泉实例地址（自建见 [palemoky/chinese-poetry-api](https://github.com/palemoky/chinese-poetry-api)，Docker 默认端口 1279）。限流、超时、每页条数也都在这个文件里。

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `site/index.html` | 页面骨架 |
| `site/assets/css/yinshi.css` | 全部样式（宣纸 / 水墨 / 朱砂；横排 / 竖排 / 田字格；手机；打印） |
| `site/assets/js/main.js` | 应用状态、交互、搜索 / 随机 / 飞花令 |
| `site/assets/js/reading.js` | 注音：pinyin-pro → 课本修正 → 吟诵旧读 → 用户自定义 |
| `site/assets/js/render.js` | 诗笺渲染（`<ruby>` 逐字格）与自适应字号 |
| `site/assets/js/exporter.js` | 导出 PNG（canvas）与带拼音文本 |
| `site/assets/js/cp.js` | 全唐诗 / 全宋诗：读本站索引，按块从 CDN 取正文、繁→简 |
| `site/assets/js/themes.js` | 纸面主题与自定义背景（IndexedDB，本机） |
| `site/data/cp/` | chinese-poetry 索引（`tools/build-cp-index.mjs` 生成） |
| `site/data/poets.json`、`notes.json` | 作者生平、诗意赏析（`python3 tools/content/build.py` 由 `tools/content/` 生成） |
| `site/assets/js/api.js` | 诗库客户端（主诗库 snowtraces + 备用诗泉自动切换、游标分页、缓存、排队节流、429 冷却） |
| `site/assets/js/zh.js` | 简繁转换（按需加载 OpenCC，逐字对齐） |
| `site/assets/js/fonts.js` | 诗文字体（8 种，按需加载） |
| `site/assets/js/store.js` | localStorage 封装 |
| `site/poem/config.js` | API 配置 |
| `site/poem/daily-poems.json` | 72 首小学必背（课本文本） |
| `site/poem/poem-readings.json` | 读音修正表（`textbook` 默认开，`recite` 默认关） |
| `site/vendor/pinyin-pro-3.29.5.min.js` | 拼音引擎（npm 原版，未修改） |
| `site/vendor/opencc-js-1.4.2/` | 简繁转换 opencc-js（npm 原版 ESM，未修改；只在切到繁体时加载） |
| `tools/bump-version.sh` | 发版时更新 `index.html` 里脚本和样式的 `?v=` 版本号，避免浏览器混用新旧缓存 |
| `site/fonts/` | 拼音字体 Noto Serif（拉丁 + 拉丁扩展子集）；`zhuque-fangsong/` 朱雀仿宋分片网页字体（默认诗文字体） |
| `tests/e2e.py` | Playwright 无头验收（用 `tests/fixtures/api.json` 模拟主诗库与备用诗库，不访问真实接口） |
| `tests/live_api.py` | 真实接口检查：返回结构是否和代码预期一致，且跨域头 `Access-Control-Allow-Origin` 恰好一个（会访问网络） |
| `tests/live_browser.py` | 真实浏览器联网检查：不拦截请求，页面跨域直连真实诗库（可传线上网址） |

### 修改读音修正表

`poem-readings.json` 每条形如 `{"p": "[朝]辞白帝", "r": "zhāo", "note": "早发白帝城：早晨"}`：`p` 是带上下文的诗句片段，用 `[ ]` 标出要改的字。只有整段片段原样出现在某一行时才生效，所以上下文越长越安全。改完刷新页面即可。

### 运行测试

```bash
pip install playwright && python3 -m playwright install chromium
python3 tests/e2e.py            # 截图输出到 tests/screens/；YINSHI_PART=base / v3 / v4 / visual 可分段运行
python3 tests/live_api.py       # 检查真实接口与跨域头
python3 tests/live_browser.py   # 真实浏览器直连诗库；也可 python3 tests/live_browser.py https://ttnan.github.io/yinshi/
# 已装系统 Chromium 时：YINSHI_CHROMIUM=/usr/bin/chromium python3 tests/e2e.py
```

## 致谢与许可

- 代码：MIT © 2026 Caesar (TTNAN)，见 [LICENSE](LICENSE)。
- 拼音：[pinyin-pro](https://github.com/zh-lx/pinyin-pro)（MIT）。
- 唐诗、宋诗：[chinese-poetry/chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)（MIT License，© 2016 JackeyGao 及贡献者）。仓库只含由它生成的索引（`site/data/cp/`），正文运行时从 unpkg / GitHub 直接读取。
- 作者生平与赏析（`site/data/poets.json`、`site/data/notes.json`，96 位诗人、178 首诗）：吟诗原创撰写，源文件在 `tools/content/`。
- 诗词数据：[snowtraces/poetry-source](https://github.com/snowtraces/poetry-source)（公共接口 poetry-api.snowtraces.com）与 [诗泉 palemoky/chinese-poetry-api](https://github.com/palemoky/chinese-poetry-api)（公共实例 [poetry.palemoky.com](https://poetry.palemoky.com)），运行时通过公开 API 获取，仓库不包含其代码。感谢两个项目的维护者。
- 简繁转换：[opencc-js](https://github.com/nk2028/opencc-js)（MIT；词典数据来自 OpenCC / opencc-data，Apache-2.0），本地托管，许可证见 `site/vendor/opencc-js-1.4.2/`。
- 字体：[朱雀仿宋 Zhuque Fangsong](https://github.com/TrionesType/zhuque)（© 2023 浙江璇玑造字 JadeFoci / TrionesType，SIL OFL 1.1，本站托管分片版，来自 [中文网字计划](https://chinese-font.netlify.app) 的 npm 包 `@chinese-fonts/zqfs`，许可证见 `site/fonts/zhuque-fangsong/OFL.txt`）、站酷小薇 ZCOOL XiaoWei、马善政楷书 Ma Shan Zheng、站酷快乐体 ZCOOL KuaiLe、龙藏体 Long Cang（均为 SIL OFL 1.1，选中时经 fonts.googleapis.cn 加载）、思源宋体 / 思源黑体 Noto Serif SC、Noto Sans SC（SIL OFL 1.1，经 fonts.googleapis.cn 加载）、[霞鹜文楷 LXGW WenKai](https://github.com/lxgw/LxgwWenKai)（SIL OFL 1.1，选「楷」时经 jsDelivr 加载）、Noto Serif（拼音，SIL OFL 1.1，本地托管）。Logo 中的「吟」字形取自霞鹜文楷（SIL OFL 1.1）。
- 感谢 [tjsky/pinyin-annotator](https://github.com/tjsky/pinyin-annotator) 带来的灵感——吟诗最初就是从它开始的；现在的版本是独立重写的新项目，不含它的代码。
