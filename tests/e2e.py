"""吟诗 · 无头浏览器验收（用录好的 API 响应模拟主诗库 snowtraces 与备用诗泉，不访问真实诗库；真实联网检查见 live_browser.py）

用法：python3 tests/e2e.py [截图输出目录]
"""
import json, os, re, sys, threading, functools, http.server
from urllib.parse import urlparse, parse_qs, unquote
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, "..", "site")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "screens")
os.makedirs(OUT, exist_ok=True)
FX = json.load(open(os.path.join(HERE, "fixtures", "api.json"), encoding="utf-8"))
FXH = json.load(open(os.path.join(HERE, "fixtures", "api-hant.json"), encoding="utf-8"))   # 同一批数据的繁体版（OpenCC 转换）

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=SITE))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}/"

calls, errors, results = [], [], {}
# 主诗库 poetry-api.snowtraces.com/v1（搜索至少 2 个字、/authors 名字→id、游标分页、随机直接 {data}）；
# 备用 poetry.palemoky.com/api（随机 / 单字 / 3 字以上搜索）。MODE["api"] = "down" 时主诗库连不上，应自动改用备用
MODE = {"api": "up"}
# 分段运行：YINSHI_PART=v7（纸面/字体只作用于诗笺）、base（基本验收）、v3（诗人搜索/筛选、备用实例、设置按钮、简繁）、v4、v5、v6（足迹地图、学习列表）或 visual（字体、长诗导出、竖排方向、字号）；默认全部
PART = os.environ.get("YINSHI_PART", "all")

def mock(route):
    u = urlparse(route.request.url); q = parse_qs(u.query); calls.append(route.request.url)
    H = {"access-control-allow-origin": "*", "content-type": "application/json"}
    if u.path.endswith("/search"):
        key = q.get("q", [""])[0]
        if len(key) < 3 and MODE["api"] != "selfhost":
            return route.fulfill(status=400, headers=H, body=json.dumps({"error": {"code": "BAD_REQUEST", "message": "q must be at least 3 characters"}}))
        body = {"data": FX["search"].get(key, []), "pagination": {"page": 1, "pageSize": 20, "hasMore": False}}
    elif u.path.endswith("/poems"):
        page = int(q.get("page", ["1"])[0])
        if MODE["api"] != "selfhost":
            body = {"data": FX["poems_unfiltered"], "pagination": {"page": page, "pageSize": 20, "hasMore": True}}
        else:
            pages = FX.get("poems_author_" + q.get("author", [""])[0])
            if not pages:
                return route.fulfill(status=404, headers=H, body=json.dumps({"error": {"code": "NOT_FOUND", "message": "author not found"}}))
            body = {"data": pages[page - 1] if page <= len(pages) else [], "pagination": {"page": page, "page_size": 20, "total_pages": len(pages)}}
    elif u.path.endswith("/poems/random"):
        if q.get("char"): body = {"data": FX.get("random_char_" + q["char"][0])}
        elif q.get("author"): body = {"data": FX.get("random_author_" + q["author"][0])}
        else: body = {"data": FX["random_default"]}
    elif u.path.endswith("/dynasties"): body = {"data": FX["dynasties"]}
    elif u.path.endswith("/types"): body = {"data": FX["types"]}
    else: return route.fulfill(status=404, headers=H, body="{}")
    route.fulfill(status=200, headers=H, body=json.dumps(body, ensure_ascii=False))

def st_item(p):
    """把录好的诗泉格式转成 snowtraces 的作品格式（简体）"""
    t = {"宋词": "ci", "元曲": "qu"}.get(p["type"]["name"], "poetry")
    return {"id": f"w{p['id']}", "type": t, "title": p["title"], "authorName": p["author"]["name"], "authorId": "a-" + p["author"]["name"],
            "dynasty": p["dynasty"]["name"], "content": p["content"]}

def mock_st(route):
    u = urlparse(route.request.url); q = parse_qs(u.query); calls.append(route.request.url)
    if MODE["api"] == "down":
        return route.abort("connectionrefused")
    H = {"access-control-allow-origin": "*", "content-type": "application/json"}
    ok = lambda data, cur=None: route.fulfill(status=200, headers=H, body=json.dumps({"data": data, "meta": {"page_size": 20, "next_cursor": cur, "count": len(data) if isinstance(data, list) else 1}, "error": None}, ensure_ascii=False))
    err = lambda st, code: route.fulfill(status=st, headers=H, body=json.dumps({"data": None, "meta": {}, "error": {"code": code, "message": code}}))
    p = unquote(u.path).replace("/v1", "", 1)
    known = lambda n: FX.get("poems_author_" + n) or FX.get("random_author_" + n)
    if p == "/authors":
        n = q.get("q", [""])[0]
        return ok([{"id": "a-" + n, "name": n, "dynasty": "唐"}] if known(n) else [])
    m = re.match(r"^/authors/a-(.+)/works$", p)
    if m:
        pages = FX.get("poems_author_" + m.group(1)) or []
        i = int(q.get("cursor", ["c1"])[0][1:]) - 1
        return ok([st_item(x) for x in (pages[i] if i < len(pages) else [])], f"c{i + 2}" if i + 1 < len(pages) else None)
    if p == "/works/random":
        aid = q.get("author_id", [""])[0]
        if aid:
            poem = FX.get("random_author_" + aid[2:])
            return ok(st_item(poem)) if poem else err(404, "NOT_FOUND")
        return ok(st_item(FX["random_default"]))
    if p == "/works":
        key = q.get("q", [""])[0]
        if len(key) < 2: return err(400, "QUERY_TOO_SHORT")
        return ok([st_item(x) for x in FX["search"].get(key, [])])
    if p == "/dynasties":
        return ok(["三国", "五代十国", "元", "南北朝", "唐", "宋", "明", "晋", "汉", "清", "秦", "金", "隋"])
    return err(404, "NOT_FOUND")

FONT_CACHE = "/tmp/yinshi-font-cache"
os.makedirs(FONT_CACHE, exist_ok=True)
def cdn(route):
    # 沙盒里浏览器直连 CDN 偶尔被代理拦（407），改由 Python 取回再喂给页面
    import hashlib, urllib.request
    url = route.request.url
    ua = route.request.headers.get("user-agent", "Mozilla/5.0 Chrome/124.0")
    fn = os.path.join(FONT_CACHE, hashlib.md5((url + ua).encode()).hexdigest())
    if not os.path.exists(fn):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": ua})
            with urllib.request.urlopen(req, timeout=30) as r: data = r.read()
            open(fn, "wb").write(data)
        except Exception:
            return route.abort()
    data = open(fn, "rb").read()
    ct = "text/css" if (url.endswith(".css") or "/css2?" in url) else "font/woff2"
    route.fulfill(status=200, headers={"access-control-allow-origin": "*", "content-type": ct}, body=data)

# 全唐诗 / 全宋诗正文：页面直连 unpkg（备用 raw.githubusercontent.com）。测试里从 tools/.cache 的本地副本喂给页面
CP_DIR = os.path.join(HERE, "..", "tools", ".cache", "chinese-poetry-2.0.1", "package", "dist", "quantangshi")
CP_DOWN = {"on": False}
def cpcdn(route):
    calls.append(route.request.url)
    if CP_DOWN["on"] and "unpkg.com" in route.request.url: return route.abort("connectionrefused")
    fn = os.path.join(CP_DIR, os.path.basename(urlparse(route.request.url).path))
    if not os.path.exists(fn): return route.fulfill(status=404, headers={"access-control-allow-origin": "*"}, body="{}")
    route.fulfill(status=200, headers={"access-control-allow-origin": "*", "content-type": "application/json"}, body=open(fn, "rb").read())

def new_page(browser, w, h, mobile=False):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if mobile else 1,
                              is_mobile=mobile, has_touch=mobile, accept_downloads=True, locale="zh-CN")
    page = ctx.new_page()
    page.route(re.compile(r"https://poetry\.palemoky\.com/.*"), mock)
    page.route(re.compile(r"https://poetry-api\.snowtraces\.com/.*"), mock_st)
    page.route(re.compile(r"https://(cdn\.jsdelivr\.net|fonts\.googleapis\.cn|fonts\.gstatic\.cn)/.*"), cdn)
    page.route(re.compile(r"https://(unpkg\.com/chinese-poetry@|raw\.githubusercontent\.com/chinese-poetry/).*"), cpcdn)
    page.on("console", lambda m: m.type in ("error", "warning") and not (MODE["api"] == "down" and "snowtraces" in (m.location.get("url", "") + m.text)) and not (CP_DOWN["on"] and "unpkg" in m.location.get("url", "")) and errors.append(f"{w}: {m.type}: {m.text} @ {m.location.get('url','')}"))
    page.on("requestfailed", lambda r: MODE["api"] != "down" and not (CP_DOWN["on"] and "unpkg" in r.url) and errors.append(f"{w}: requestfailed: {r.url[:90]}"))
    page.on("response", lambda r: r.status >= 400 and errors.append(f"{w}: {r.status}: {r.url[:110]}"))
    page.on("pageerror", lambda e: errors.append(f"{w}: pageerror: {e}"))
    return page

def settle(page, ms=1400):
    page.wait_for_timeout(ms)

def rt_of(page, ch):
    return page.eval_on_selector_all(".poem-body ruby.c", "(els, ch) => els.filter(e => e.querySelector('.h').textContent === ch).map(e => e.querySelector('rt').textContent)", ch)

def overlaps(page):
    # 任何两个相邻字格是否重叠、拼音是否超出字格
    return page.evaluate("""() => {
      const bad = [];
      const cells = [...document.querySelectorAll('.poem-body ruby.c, .poem-body .pc')];
      for (let i = 1; i < cells.length; i++) {
        const a = cells[i-1].getBoundingClientRect(), b = cells[i].getBoundingClientRect();
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 2 && iy > 2) bad.push('overlap ' + cells[i-1].textContent + '/' + cells[i].textContent);
      }
      document.querySelectorAll('.poem ruby.c rt').forEach(rt => {
        if (rt.scrollWidth > rt.parentElement.getBoundingClientRect().width + 1 && !document.querySelector('.poem.m-v')) bad.push('rt wide ' + rt.textContent);
      });
      const card = document.querySelector('.card').getBoundingClientRect();
      document.querySelectorAll('.poem .h').forEach(h => { const r = h.getBoundingClientRect(); if (r.right > card.right + 1 || r.left < card.left - 1) bad.push('clip ' + h.textContent); });
      return bad.slice(0, 10);
    }""")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("YINSHI_CHROMIUM") or None)
    if PART in ("all", "base"):
        # ---- 桌面 1440 ----
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 2600)
        results["first_load_calls"] = len(calls)
        results["first_title"] = pg.inner_text(".poem-title")
        results["today_tag"] = pg.locator(".tag-today").count()
        results["ov_h"] = overlaps(pg)
        pg.screenshot(path=f"{OUT}/01-desktop-daily-horizontal.png", full_page=True)
        pg.click('#modeSeg [data-mode="v"]'); settle(pg, 2200)
        results["ov_v"] = overlaps(pg)
        pg.screenshot(path=f"{OUT}/02-desktop-vertical.png", full_page=True)
        pg.click('#modeSeg [data-mode="g"]'); settle(pg, 2200)
        results["ov_g"] = overlaps(pg)
        pg.screenshot(path=f"{OUT}/03-desktop-tianzige.png", full_page=True)
        pg.click('#modeSeg [data-mode="h"]'); settle(pg, 600)
        # 飞花令
        pg.click("#btnFeihua"); pg.fill(".fh-input", "春"); pg.screenshot(path=f"{OUT}/04a-feihua-popover.png")
        pg.press(".fh-input", "Enter"); settle(pg, 2400)
        results["fh_title"] = pg.inner_text(".poem-title")
        results["fh_hl"] = pg.locator(".poem-body ruby.c.hl").count()
        results["ov_fh"] = overlaps(pg)
        results["chunwang_sheng"] = rt_of(pg, "胜")
        pg.screenshot(path=f"{OUT}/04-desktop-feihua-chun.png", full_page=True)
        # 山行
        pg.fill("#q", "山行"); settle(pg, 500)
        pg.press("#q", "Enter"); settle(pg, 900)
        pg.screenshot(path=f"{OUT}/06a-desktop-search-shanxing.png")
        pg.click("#results .res >> nth=0"); settle(pg, 2400)
        results["shanxing_xie"] = rt_of(pg, "斜")
        pg.screenshot(path=f"{OUT}/06-desktop-shanxing-xie.png", full_page=True)
        # 改读音浮层
        pg.click('.poem-body ruby.c:has(.h:text-is("斜"))'); settle(pg, 400)
        pg.screenshot(path=f"{OUT}/07-desktop-char-popover.png")
        pg.keyboard.press("Escape")
        # 吟诵旧读
        pg.click("#btnSettings"); pg.click('[data-set="recite"]'); settle(pg, 400)
        results["shanxing_recite"] = rt_of(pg, "斜")
        pg.screenshot(path=f"{OUT}/08-desktop-settings.png")
        pg.click('[data-set="recite"]'); pg.keyboard.press("Escape")
        # 自定义读音持久化
        pg.click('.poem-body ruby.c:has(.h:text-is("坐"))'); pg.fill(".pop-char input", "zuo3"); pg.press(".pop-char input", "Enter"); settle(pg, 300)
        pg.reload(); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 800)
        # 刷新后回到今日一诗；再载入山行看覆盖是否还在
        pg.fill("#q", "山行"); pg.press("#q", "Enter"); settle(pg, 700); pg.click("#results .res >> nth=0"); settle(pg, 900)
        results["override_persist"] = pg.locator(".poem-body ruby.c.ov").count()
        # 遮字背诵
        pg.click("#togVeil"); settle(pg, 300); pg.click(".line >> nth=1"); settle(pg, 500)
        pg.screenshot(path=f"{OUT}/09-desktop-recite-veil.png", full_page=True)
        pg.click("#togVeil")
        # 课本版切换（随机返回诗库版静夜思）
        pg.click("#btnRandom"); settle(pg, 2200)
        results["alt_note"] = pg.inner_text("#cardNote")
        pg.screenshot(path=f"{OUT}/10-desktop-textbook-switch.png", full_page=True)
        pg.click("#cardNote [data-alt]"); settle(pg, 1200)
        results["after_alt_first_line"] = "".join(pg.eval_on_selector_all(".line >> nth=0 >> .h", "els => els.map(e=>e.textContent)")) if False else pg.inner_text(".line >> nth=0").replace("\n", "")
        # 复制带拼音文本
        pg.context.grant_permissions(["clipboard-read", "clipboard-write"])
        pg.click("#btnCopy"); settle(pg, 300)
        results["copy_text"] = pg.evaluate("navigator.clipboard.readText()")
        # 导出图片
        with pg.expect_download() as dl:
            pg.click("#btnImage")
        dl.value.save_as(f"{OUT}/11-export.png")
        # 打印预览
        pg.emulate_media(media="print"); settle(pg, 300)
        pg.screenshot(path=f"{OUT}/12-print-media.png", full_page=True)
        pg.emulate_media(media="screen")
        # 筛选抽屉
        pg.click("#btnFilter"); settle(pg, 900)
        pg.screenshot(path=f"{OUT}/13-desktop-filter-drawer.png")
        pg.context.close()

        # ---- 手机 390 ----
        m = new_page(b, 390, 844, mobile=True)
        m.goto(BASE); m.wait_for_selector(".poem-body ruby.c"); settle(m, 2600)
        results["ov_m"] = overlaps(m)
        m.screenshot(path=f"{OUT}/05a-mobile-daily.png")
        m.click("#dSearch"); m.fill("#q2", "静夜思"); m.press("#q2", "Enter"); settle(m, 1000)
        results["m_results"] = m.locator("#results .res").count()
        m.screenshot(path=f"{OUT}/05-mobile-search-sheet.png")
        m.click("#results .res >> nth=0"); settle(m, 2200)
        m.click("#dMode"); settle(m, 2200)
        results["ov_mv"] = overlaps(m)
        m.screenshot(path=f"{OUT}/05b-mobile-vertical.png")
        m.click("#dMode"); settle(m, 2200)
        results["ov_mg"] = overlaps(m)
        m.screenshot(path=f"{OUT}/05c-mobile-tianzige.png")
        m.click("#dMode"); settle(m, 500)
        m.click("#dFeihua"); settle(m, 400)
        m.screenshot(path=f"{OUT}/05d-mobile-feihua-sheet.png")
        m.click('[data-fh-ch="春"]'); settle(m, 2400)
        results["ov_mfh"] = overlaps(m)
        m.screenshot(path=f"{OUT}/05e-mobile-feihua-chun.png")
        m.context.close()

    if PART in ("all", "v3"):
        # ---- 搜索：主实例（单字搜索、按诗人搜索） ----
        MODE["api"] = "up"
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 800)
        pg.fill("#q", "李白"); pg.press("#q", "Enter"); settle(pg, 1200)
        results["libai_sections"] = pg.eval_on_selector_all("#results .res-sec", "els => els.map(e => e.textContent)")
        results["libai_first"] = pg.eval_on_selector_all("#results .res-t", "els => els.slice(0, 6).map(e => e.textContent)")
        results["libai_status"] = pg.inner_text("#sheetStatus")
        results["libai_author_calls"] = [c for c in calls if "/authors" in c]
        pg.screenshot(path=f"{OUT}/20-search-libai.png")
        n_before = pg.locator("#results .res").count()
        pg.click("[data-more-author]"); settle(pg, 900)
        results["libai_more"] = [n_before, pg.locator("#results .res").count(), pg.locator("[data-more-author]").count()]
        pg.fill("#q", "月"); pg.press("#q", "Enter"); settle(pg, 1200)
        results["yue_titles"] = pg.eval_on_selector_all("#results .res-t", "els => els.map(e => e.textContent)")
        results["yue_status"] = pg.inner_text("#sheetStatus")
        pg.screenshot(path=f"{OUT}/21-search-yue.png")
        # 诗笺上的作者名：读一首李白的诗 → 点「李白」→「更多 李白 的诗」
        pg.fill("#q", "静夜思"); pg.press("#q", "Enter"); settle(pg, 900)
        pg.click("#results .res >> nth=0"); settle(pg, 1600)
        pg.click("#poemView .meta-au"); settle(pg, 300)
        results["author_pop"] = pg.inner_text("#pop").replace("\n", " ")
        pg.screenshot(path=f"{OUT}/23-author-pop.png")
        pg.click("[data-author-more]"); settle(pg, 1200)
        results["author_more_sections"] = pg.eval_on_selector_all("#results .res-sec", "els => els.map(e => e.textContent)")
        pg.keyboard.press("Escape")
        # 诗人筛选：点常见诗人「杜甫」→ 按条件随机
        pg.click("#btnFilter"); settle(pg, 700)
        pg.click('[data-poet="杜甫"]'); settle(pg, 200)
        results["poet_input"] = pg.input_value("#fAuthor")
        pg.screenshot(path=f"{OUT}/24-filter-poet.png")
        n0 = len(calls)
        pg.click("#btnFilterGo"); settle(pg, 1600)
        results["poet_random_call"] = [c for c in calls[n0:] if "random" in c]
        results["poet_random_title"] = pg.inner_text(".poem-title").replace("\n", "")
        pg.context.close()

        # ---- 主实例连不上：自动改用备用实例 ----
        MODE["api"] = "down"
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 800)
        n0 = len(calls)
        pg.fill("#q", "静夜思"); pg.press("#q", "Enter"); settle(pg, 1600)
        results["down_hosts"] = [urlparse(c).netloc for c in calls[n0:]]
        results["down_results"] = pg.locator("#results .res").count()
        pg.fill("#q", "李白"); pg.press("#q", "Enter"); settle(pg, 1200)
        results["down_libai_status"] = pg.inner_text("#sheetStatus")
        pg.context.close()
        MODE["api"] = "up"

        # ---- 设置面板：真实点击每个按钮，诗笺跟着变，刷新后还在 ----
        def poem_state(page):
            return page.evaluate("""() => { const v = document.getElementById('poemView'); const cs = getComputedStyle(v);
              return { fs: v.dataset.fs, cs: cs.getPropertyValue('--cs').trim(), pyr: cs.getPropertyValue('--pyr').trim(), lg: cs.getPropertyValue('--lg').trim(), cls: v.className,
                       rt: getComputedStyle(document.querySelector('.poem-body ruby.c rt')).fontSize }; }""")
        for mobile in (False, True):
            tag = "m" if mobile else "d"
            pg = new_page(b, 390 if mobile else 1440, 844 if mobile else 1000, mobile=mobile)
            pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1200)
            seq = [("size", '[data-disp-size="l"]'), ("py", '[data-disp-py="l"]'), ("lh", '[data-disp-lh="loose"]'), ("vdir", '[data-vdir="lr"]')]
            out = {"before": poem_state(pg)}
            pg.click("#btnSettings"); settle(pg, 300)
            for k, sel in seq:
                (pg.tap if mobile else pg.click)(sel); settle(pg, 500)
                out[k] = [pg.get_attribute(sel, "aria-checked"), pg.locator("#pop").is_visible(), poem_state(pg)]
            pg.screenshot(path=f"{OUT}/25-settings-after-clicks-{tag}.png")
            pg.keyboard.press("Escape")
            pg.reload(); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1200)
            out["after_reload"] = poem_state(pg)
            pg.click("#btnSettings"); settle(pg, 300)
            out["after_reload_checked"] = [pg.get_attribute(sel, "aria-checked") for _, sel in seq]
            results["settings_" + tag] = out
            pg.context.close()

        # ---- 简 / 繁 ----
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1000)
        pg.fill("#q", "山行"); pg.press("#q", "Enter"); settle(pg, 700); pg.click("#results .res >> nth=0"); settle(pg, 1200)
        # 自定义一个读音，切到繁体后应仍然生效
        pg.click('.poem-body ruby.c:has(.h:text-is("坐"))'); pg.fill(".pop-char input", "zuo3"); pg.press(".pop-char input", "Enter"); settle(pg, 300)
        cells = "els => els.map(e => e.querySelector('.h').textContent + ':' + e.querySelector('rt').textContent)"
        hans_cells = pg.eval_on_selector_all(".poem-body ruby.c", cells)
        pg.click("#btnSettings"); settle(pg, 250); pg.click('[data-lang="hant"]'); settle(pg, 1800); pg.keyboard.press("Escape")
        hant_cells = pg.eval_on_selector_all(".poem-body ruby.c", cells)
        results["hant_title"] = pg.inner_text(".poem-title").replace("\n", "")
        results["hant_meta"] = pg.inner_text(".poem-meta")
        results["hant_text"] = "".join(c.split(":")[0] for c in hant_cells)
        results["hant_pinyin_same"] = [c.split(":")[1] for c in hans_cells] == [c.split(":")[1] for c in hant_cells]
        results["hant_override_kept"] = pg.locator(".poem-body ruby.c.ov").count()
        results["hant_xie"] = rt_of(pg, "斜")
        pg.screenshot(path=f"{OUT}/61-hant-horizontal-shanxing.png", full_page=True)
        pg.context.grant_permissions(["clipboard-read", "clipboard-write"])
        pg.click("#btnCopy"); settle(pg, 300)
        results["hant_copy"] = pg.evaluate("navigator.clipboard.readText()")[:80]
        n0 = len(calls)
        pg.click("#btnRandom"); settle(pg, 1800)
        results["hant_random_call"] = [c for c in calls[n0:] if "random" in c]
        results["hant_random_title"] = pg.inner_text(".poem-title").replace("\n", "")
        results["hant_random_alt"] = pg.inner_text("#cardNote")
        pg.reload(); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1800)
        results["hant_after_reload_title"] = pg.inner_text(".poem-title").replace("\n", "")
        pg.screenshot(path=f"{OUT}/61-hant-horizontal-daily.png", full_page=True)
        pg.fill("#q", "李白"); pg.press("#q", "Enter"); settle(pg, 1200)
        results["hant_search_calls"] = [c for c in calls if "/works?" in c][-2:]
        results["hant_libai_sections"] = pg.eval_on_selector_all("#results .res-sec", "els => els.map(e => e.textContent)")
        results["hant_libai_titles"] = pg.eval_on_selector_all("#results .res-t", "els => els.slice(0, 8).map(e => e.textContent)")
        results["hant_author_calls"] = [c for c in calls if "/authors" in c][-2:]
        pg.screenshot(path=f"{OUT}/61-hant-search-libai.png")
        pg.context.close()

    if PART in ("all", "v4"):
        # ---- 全唐诗 / 全宋诗：李白、杜甫、静夜思 ----
        pg = new_page(b, 1600, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 800)
        def search(q, ms=1500):
            pg.fill("#q", q); pg.press("#q", "Enter")
            pg.wait_for_function("() => !document.querySelector('#sheetStatus .loading')", timeout=20000); settle(pg, 300)
        uniq = "els => { const k = els.map(e => e.innerText.replace(/\\s+/g, '')); return [k.length, new Set(k).size]; }"
        search("李白")
        results["v4_libai_sections"] = pg.eval_on_selector_all("#results .res-sec", "e => e.map(x => x.textContent)")
        for _ in range(2):
            n0 = pg.locator("#results .res").count()
            pg.click("[data-more-author]"); pg.wait_for_function(f"() => document.querySelectorAll('#results .res').length > {n0}", timeout=20000); settle(pg, 200)
        results["v4_libai_count_unique"] = pg.eval_on_selector_all("#results .res", uniq)
        results["v4_libai_has_more"] = pg.locator("[data-more-author]").count()
        results["v4_libai_titles"] = pg.eval_on_selector_all("#results .res-t", "e => e.map(x => x.textContent)")
        results["v4_libai_titles"] = [t for t in results["v4_libai_titles"] if any(k in t for k in ("静夜思", "将进酒", "望庐山瀑布", "蜀道难"))]
        pg.screenshot(path=f"{OUT}/70-libai-cp.png")
        pg.click("#results .res-sec-au ~ li .res >> nth=3"); settle(pg, 1200)
        results["v4_libai_opened"] = pg.inner_text(".poem-title").replace("\n", "") + " / " + pg.inner_text(".poem-meta")
        pg.click("#poemView .meta-au"); settle(pg, 300); t0 = pg.inner_text(".poem-title")
        pg.click("[data-author-rand]"); pg.wait_for_function("t => document.querySelector('.poem-title').innerText !== t", arg=t0, timeout=15000); settle(pg, 600)
        results["v4_libai_random"] = pg.inner_text(".poem-title").replace("\n", "") + " / " + pg.inner_text(".poem-meta")
        search("杜甫")
        results["v4_dufu_sections"] = pg.eval_on_selector_all("#results .res-sec", "e => e.map(x => x.textContent)")
        results["v4_dufu_count_unique"] = pg.eval_on_selector_all("#results .res", uniq)
        search("春望"); results["v4_chunwang_first"] = pg.eval_on_selector_all("#results .res", "e => e.slice(0, 3).map(x => x.innerText.split('\\n').slice(0, 2).join(' / '))")
        search("静夜思"); results["v4_jys_first"] = pg.eval_on_selector_all("#results .res", "e => e.slice(0, 3).map(x => x.innerText.split('\\n').slice(0, 2).join(' / '))")
        search("将进酒"); results["v4_jjj_first"] = pg.eval_on_selector_all("#results .res", "e => e.slice(0, 3).map(x => x.innerText.split('\\n').slice(0, 2).join(' / '))")
        pg.screenshot(path=f"{OUT}/71-search-jiangjinjiu.png")
        pg.click("#results .res >> nth=0"); settle(pg, 1500)
        results["v4_jjj_note"] = pg.inner_text("#sideNoteBody")[:60]
        pg.keyboard.press("Escape")
        # unpkg 连不上：改用 raw.githubusercontent.com
        CP_DOWN["on"] = True
        search("王维"); results["v4_wangwei_cdn_fallback"] = [pg.locator("#results .res").count(), [urlparse(c).netloc for c in calls if "chinese-poetry" in c][-2:]]
        CP_DOWN["on"] = False
        pg.context.close()

        # ---- 遮字背诵：换版面 / 简繁 / 拼音时，被遮住的字一帧也不能露出来 ----
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1200)
        pg.click("#togVeil"); settle(pg, 600)
        pg.evaluate("""() => { window.__flash = []; window.__lines = 0;
          const chk = (why) => { document.querySelectorAll('#poemView .line').forEach((l) => { window.__lines++;
              if (!l.classList.contains('veiled')) window.__flash.push(why + ':unveiled-line');
              l.querySelectorAll('.h').forEach((h) => { const o = +getComputedStyle(h).opacity; if (o > 0.4) window.__flash.push(why + ':opacity ' + o.toFixed(2)); }); }); };
          new MutationObserver(() => chk('mutation')).observe(document.getElementById('poemView'), { childList: true, subtree: true });
          const tick = () => { chk('frame'); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }""")
        seq = ['#modeSeg [data-mode="g"]', '#modeSeg [data-mode="v"]', '#modeSeg [data-mode="h"]', '#modeSeg [data-mode="v"]', '#modeSeg [data-mode="g"]', '#modeSeg [data-mode="h"]', "#togPinyin", "#togPinyin"]
        for sel in seq: pg.click(sel); settle(pg, 900)
        pg.click("#btnSettings"); settle(pg, 250); pg.click('[data-lang="hant"]'); settle(pg, 2200); pg.click('[data-lang="hans"]'); settle(pg, 1200); pg.keyboard.press("Escape")
        pg.click('#modeSeg [data-mode="g"]'); settle(pg, 900)
        results["v4_veil_flash"] = pg.evaluate("[window.__flash.length, window.__flash.slice(0, 5), window.__lines]")
        pg.screenshot(path=f"{OUT}/72-veil-tianzige.png")
        pg.context.close()

        # ---- 侧栏：宽屏两侧（不挤动诗笺）、窄屏下方可展开 ----
        pg = new_page(b, 1600, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1800)
        box = lambda sel: pg.evaluate(f"(() => {{ const r = document.querySelector('{sel}').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }})()")
        results["v4_side_wide"] = {"card": box("#poem"), "au": box("#sideAu"), "note": box("#sideNote"), "au_text": pg.inner_text("#sideAuBody")[:30], "note_text": pg.inner_text("#sideNoteBody")[:30]}
        pg.evaluate("document.getElementById('sideAu').hidden = true; document.getElementById('sideNote').hidden = true")
        results["v4_side_wide"]["card_without"] = box("#poem")
        pg.evaluate("document.getElementById('sideAu').hidden = false; document.getElementById('sideNote').hidden = false")
        pg.screenshot(path=f"{OUT}/73-side-panels-desktop.png")
        pg.click("#btnSettings"); settle(pg, 250); pg.click('[data-lang="hant"]'); settle(pg, 2000); pg.keyboard.press("Escape")
        results["v4_side_hant"] = pg.inner_text("#sideAuBody")[:24]
        pg.screenshot(path=f"{OUT}/74-side-panels-hant.png")
        pg.click("#btnSettings"); settle(pg, 250); pg.click('[data-lang="hans"]'); settle(pg, 800); pg.keyboard.press("Escape")
        pg.context.close()
        m = new_page(b, 390, 844, mobile=True)
        m.goto(BASE); m.wait_for_selector(".poem-body ruby.c"); settle(m, 1600)
        card0 = m.evaluate("document.getElementById('poem').getBoundingClientRect().top")
        results["v4_side_mobile_collapsed"] = m.evaluate("[getComputedStyle(document.getElementById('sideAuBody')).display, getComputedStyle(document.getElementById('sideNoteBody')).display]")
        m.evaluate("document.getElementById('sideAu').scrollIntoView({block: 'center'})"); settle(m, 300)
        m.screenshot(path=f"{OUT}/75-side-mobile-collapsed.png")
        m.tap("#sideAu .side-toggle"); m.tap("#sideNote .side-toggle"); settle(m, 300)
        results["v4_side_mobile_open"] = m.evaluate("[getComputedStyle(document.getElementById('sideAuBody')).display, document.querySelector('#sideAu .side-toggle').getAttribute('aria-expanded')]")
        m.evaluate("document.getElementById('sideNote').scrollIntoView({block: 'end'})"); settle(m, 300)
        m.screenshot(path=f"{OUT}/76-side-mobile-expanded.png")
        results["v4_card_not_moved"] = m.evaluate(f"Math.abs(document.getElementById('poem').getBoundingClientRect().top + window.scrollY - ({card0}))") < 2
        m.context.close()

        # ---- 纸面主题：每种截图、对比度、导出图片；自定义背景（上传、遮罩、刷新后还在、移除） ----
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1500)
        CONTRAST = """() => { const rgb = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return m; };
          const lum = (c) => { const [r, g, b] = rgb(c).slice(0, 3).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
          const ratio = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + .05) / (Math.min(x, y) + .05)).toFixed(2); };
          const cs = getComputedStyle(document.documentElement);
          const card = getComputedStyle(document.getElementById('poem')).backgroundColor;
          const h = getComputedStyle(document.querySelector('.poem-body ruby.c .h')).color, rt = getComputedStyle(document.querySelector('.poem-body ruby.c rt')).color;
          const probe = document.createElement('i'); probe.style.color = getComputedStyle(document.getElementById('poem')).getPropertyValue('--grid'); document.body.appendChild(probe); const grid = getComputedStyle(probe).color; probe.remove();
          return { han: ratio(h, card), pinyin: ratio(rt, card), grid: ratio(grid, card), card }; }"""
        th = {}
        for k in ["xuan", "su", "zhu", "juan", "qinghua", "ye", "xin"]:
            pg.click("#btnSettings"); settle(pg, 250); pg.click(f'[data-theme-k="{k}"]'); settle(pg, 500); pg.keyboard.press("Escape"); settle(pg, 1600)
            th[k] = pg.evaluate(CONTRAST)
            th[k]["attr"] = pg.evaluate("document.documentElement.dataset.theme || 'xuan'")
            pg.screenshot(path=f"{OUT}/80-theme-{k}.png")
            if k in ("ye", "qinghua"):
                pg.click('#modeSeg [data-mode="g"]'); settle(pg, 1500); pg.screenshot(path=f"{OUT}/80-theme-{k}-tianzige.png")
                with pg.expect_download() as dl: pg.click("#btnImage")
                dl.value.save_as(f"{OUT}/81-export-{k}-tianzige.png"); settle(pg, 300)
                pg.click('#modeSeg [data-mode="h"]'); settle(pg, 800)
        results["v4_themes"] = th
        pg.click("#btnSettings"); settle(pg, 300)
        pg.screenshot(path=f"{OUT}/82-settings-themes.png")
        # 自定义背景：生成一张 2400×1600 的图上传
        import base64, struct, zlib as _z
        def png(w, h):
            raw = b"".join(b"\x00" + b"".join(bytes([60 + (x * 120 // w), 110 + (y * 80 // h), 150]) for x in range(w)) for y in range(h))
            ck = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", _z.crc32(t + d) & 0xffffffff)
            return b"\x89PNG\r\n\x1a\n" + ck(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ck(b"IDAT", _z.compress(raw)) + ck(b"IEND", b"")
        open("/tmp/yinshi-bg.png", "wb").write(png(1200, 800))
        pg.set_input_files("#bgFile", "/tmp/yinshi-bg.png"); settle(pg, 1500)
        results["v4_custom"] = pg.evaluate("[document.documentElement.dataset.theme, !!document.documentElement.style.getPropertyValue('--user-bg'), localStorage.getItem('yinshi:theme')]")
        pg.fill("[data-bg-veil]", "0.8"); pg.dispatch_event("[data-bg-veil]", "input"); settle(pg, 300)
        results["v4_custom_veil"] = pg.evaluate("document.documentElement.style.getPropertyValue('--veil-a')")
        pg.keyboard.press("Escape"); settle(pg, 400)
        pg.screenshot(path=f"{OUT}/83-theme-custom.png")
        with pg.expect_download() as dl: pg.click("#btnImage")
        dl.value.save_as(f"{OUT}/84-export-custom.png"); settle(pg, 300)
        pg.reload(); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1500)
        results["v4_custom_after_reload"] = pg.evaluate("[document.documentElement.dataset.theme, !!document.documentElement.style.getPropertyValue('--user-bg')]")
        pg.emulate_media(media="print"); settle(pg, 300)
        results["v4_print_bg"] = pg.evaluate("[getComputedStyle(document.body).backgroundImage, getComputedStyle(document.querySelector('.poem-body ruby.c .h')).color]")
        pg.screenshot(path=f"{OUT}/85-print-custom.png", full_page=True); pg.emulate_media(media="screen")
        pg.click("#btnSettings"); settle(pg, 300); pg.click("[data-bg-remove]"); settle(pg, 800)
        results["v4_custom_removed"] = pg.evaluate("[document.documentElement.dataset.theme || 'xuan', !!document.documentElement.style.getPropertyValue('--user-bg')]")
        pg.context.close()
        m = new_page(b, 390, 844, mobile=True)
        m.goto(BASE); m.wait_for_selector(".poem-body ruby.c"); settle(m, 1200)
        m.click("#btnSettings"); settle(m, 400); m.click('[data-theme-k="ye"]'); settle(m, 600)
        m.screenshot(path=f"{OUT}/86-mobile-settings-themes.png"); m.keyboard.press("Escape"); settle(m, 1200)
        m.screenshot(path=f"{OUT}/87-mobile-theme-ye.png")
        m.context.close()

    if PART in ("all", "v5"):
        # ---- 第二批：朗读、点词注释、平仄、默写、收藏/背诵打卡、分类、接龙、相关诗、打印选项、节令 ----
        FAKE_TTS = """(() => {
          const V = [{ name: 'Fake 普通话', lang: 'zh-CN', localService: true, default: true }, { name: 'Fake EN', lang: 'en-US', localService: true }];
          window.__spoken = [];
          class U { constructor(t) { this.text = t; } }
          window.SpeechSynthesisUtterance = U;
          const synth = { speaking: false, pending: false, getVoices: () => V, addEventListener() {}, cancel() { this.speaking = false; this._stop = true; },
            speak(u) { this._stop = false; this.speaking = true; window.__spoken.push(u.text + '@' + u.rate); u.onstart && u.onstart();
              const chars = Array.from(u.text); let i = 0;
              const t = setInterval(() => { if (this._stop) { clearInterval(t); return; } if (i < chars.length) { u.onboundary && u.onboundary({ charIndex: i, name: 'word' }); i++; } else { clearInterval(t); this.speaking = false; u.onend && u.onend(); } }, 40); } };
          Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
        })();"""
        pg = new_page(b, 1600, 1000)
        pg.add_init_script(FAKE_TTS)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 2200)
        results["v5_study_buttons"] = pg.eval_on_selector_all(".study .st", "e => e.map(x => (x.hidden ? '(隐藏)' : '') + x.innerText)")
        # 朗读：整首，逐字高亮
        pg.click("#btnRead"); settle(pg, 400)
        pg.screenshot(path=f"{OUT}/90-read-pop.png")
        pg.click("[data-read-all]")
        results["v5_read_highlight"] = pg.wait_for_function("() => { const e = document.querySelectorAll('#poemView .poem-body ruby.say .h'); return e.length ? [...e].map(x => x.textContent) : null; }", timeout=8000).json_value()
        pg.screenshot(path=f"{OUT}/91-read-highlight.png")
        pg.wait_for_function("() => window.__spoken.length >= 3", timeout=15000)
        results["v5_spoken"] = pg.evaluate("window.__spoken.slice(0, 3)")
        pg.click("#btnRead"); settle(pg, 300)
        results["v5_read_stopped"] = [pg.inner_text("#btnRead"), pg.locator("#poemView ruby.say").count()]
        # 点词看注释：有虚线的字 → 浮层里先显示释义
        results["v5_ci_marked"] = pg.eval_on_selector_all("#poemView ruby.ci", "e => [...new Set(e.map(x => x.dataset.ci))]")
        pg.click("#poemView ruby.ci >> nth=0"); settle(pg, 300)
        results["v5_gloss"] = pg.inner_text("#pop .gloss") if pg.locator("#pop .gloss").count() else ""
        pg.screenshot(path=f"{OUT}/92-gloss-pop.png"); pg.keyboard.press("Escape")
        # 平仄
        pg.click("#btnSettings"); settle(pg, 250); pg.check('[data-set="pingze"]'); settle(pg, 900); pg.keyboard.press("Escape"); settle(pg, 300)
        results["v5_pingze"] = pg.eval_on_selector_all("#poemView .poem-body ruby .pz", "e => e.slice(0, 10).map(x => x.className.replace('pz pz-', ''))")
        results["v5_pingze_tip"] = pg.inner_text("#cardTip")
        pg.screenshot(path=f"{OUT}/93-pingze.png")
        pg.click("#btnSettings"); settle(pg, 250); pg.uncheck('[data-set="pingze"]'); settle(pg, 600); pg.keyboard.press("Escape")
        # 默写：挖空 → 选字 / 写字 → 计分
        pg.click("#btnDictate"); settle(pg, 900)
        nb = pg.locator("#poemView ruby.blank").count()
        DAILY_FX = {d["t"]: d for d in json.load(open(os.path.join(SITE, "poem", "daily-poems.json"), encoding="utf-8"))["poems"]}
        tt = pg.eval_on_selector_all(".poem-title > ruby .h", "e => e.map(x => x.textContent).join('')")
        cur_title = next(t for t in DAILY_FX if t.startswith(tt))
        results["v5_dict_blanks"] = nb
        pg.screenshot(path=f"{OUT}/94-dictation.png")
        for i in range(nb):
            el = pg.locator("#poemView ruby.blank:not(.ok):not(.bad)").first
            el.click(); settle(pg, 250)
            if i == 0:
                pg.screenshot(path=f"{OUT}/95-dictation-pop.png")
                pg.click("#pop [data-dict-pick] >> nth=0")
            else:
                # 其余空格写正确的字（从课本数据里取原字）
                k = pg.evaluate("document.getElementById('pop').dataset.k")
                l, c = map(int, k.split(":"))
                pg.fill("#pop [data-dict-type] input", list(DAILY_FX[cur_title]["lines"][l])[c])
                pg.press("#pop [data-dict-type] input", "Enter")
            settle(pg, 300)
        results["v5_dict_result"] = pg.inner_text("#cardTip")
        results["v5_dict_marks"] = [pg.locator("#poemView ruby.blank.ok").count(), pg.locator("#poemView ruby.blank.bad").count()]
        pg.screenshot(path=f"{OUT}/96-dictation-score.png")
        pg.click("#cardTip [data-dict-end]"); settle(pg, 500)
        # 收藏、背会了 → 诗单
        pg.click("#btnFav"); settle(pg, 300); pg.click("#btnRecited"); settle(pg, 300)
        results["v5_fav_recite"] = [pg.inner_text("#btnFav"), pg.inner_text("#btnRecited"), pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('yinshi:recite')))")]
        # 两天后：该复习了（首页提示）
        rec = pg.evaluate("localStorage.getItem('yinshi:recite')")
        pg.evaluate("""() => { const r = JSON.parse(localStorage.getItem('yinshi:recite')); for (const k in r) r[k].next = '2020-01-01'; localStorage.setItem('yinshi:recite', JSON.stringify(r)); }""")
        pg.reload(); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1500)
        results["v5_due_chip"] = pg.inner_text("#dueChip") if pg.locator("#dueChip").is_visible() else "(hidden)"
        pg.screenshot(path=f"{OUT}/97-due-chip.png")
        pg.click("#dueChip"); settle(pg, 600)
        results["v5_mine"] = pg.inner_text("#browseBody")[:160]
        pg.screenshot(path=f"{OUT}/98-browse-mine.png")
        # 分类
        pg.click('#browse [data-tab="cat"]'); settle(pg, 300); pg.click('[data-bsel="g:三年级"]'); settle(pg, 300)
        results["v5_grade3"] = pg.eval_on_selector_all("#browseBody .res-t", "e => e.map(x => x.textContent)")
        pg.screenshot(path=f"{OUT}/99-browse-grade.png")
        pg.click('[data-bsel="t:思乡"]'); settle(pg, 300)
        results["v5_theme_sixiang"] = pg.eval_on_selector_all("#browseBody .res-t", "e => e.map(x => x.textContent)")
        pg.click("#browseBody .res >> nth=0"); settle(pg, 1500)
        results["v5_browse_open"] = pg.inner_text(".poem-title").replace("\n", "")
        # 相关的诗
        results["v5_related"] = pg.eval_on_selector_all("#sideNote .rel button", "e => e.map(x => x.innerText.replace(/\\n/g, ' '))")
        pg.screenshot(path=f"{OUT}/100-related.png")
        if results["v5_related"]:
            pg.click("#sideNote .rel button >> nth=0"); settle(pg, 1200)
            results["v5_related_open"] = pg.inner_text(".poem-title").replace("\n", "")
        # 接龙
        pg.click("#btnBrowse"); settle(pg, 400); pg.click('#browse [data-tab="jl"]'); settle(pg, 300)
        for _ in range(6):     # 开局那句可能接不上（本地没有、备用诗库在测试里是录好的数据）：再开一局
            pg.click("[data-jl-start]"); settle(pg, 1500)
            if pg.locator("[data-jl-pick]").count(): break
        q = pg.inner_text("#browseBody .b-h >> nth=1")
        ch = pg.evaluate("document.querySelector('#browseBody .b-h .zhu').textContent")
        opts = pg.eval_on_selector_all("[data-jl-pick]", "e => e.map(x => x.textContent)")
        good = next((i for i, o in enumerate(opts) if o.startswith(ch)), 0)
        pg.click(f'[data-jl-pick="{good}"]'); settle(pg, 1200)
        results["v5_jielong"] = [ch, opts, pg.inner_text("#browseBody .b-h >> nth=0")]
        pg.screenshot(path=f"{OUT}/101-jielong.png")
        pg.keyboard.press("Escape"); settle(pg, 300)
        # 打印 / 导出选项
        pg.click("#btnPrint"); settle(pg, 300)
        for k in ("yi", "ci", "shang", "big"):
            if pg.locator(f'[data-popt="{k}"]:not([disabled])').count(): pg.check(f'[data-popt="{k}"]')
        pg.uncheck('[data-popt="py"]')
        pg.screenshot(path=f"{OUT}/102-print-options.png")
        pg.evaluate("window.print = () => { window.__printed = [document.body.className, document.getElementById('printExtra').innerText.slice(0, 40)]; }")
        pg.click("[data-do-print]"); settle(pg, 800)
        results["v5_print"] = pg.evaluate("window.__printed")
        pg.emulate_media(media="print"); settle(pg, 300)
        pg.screenshot(path=f"{OUT}/103-print-with-notes.png", full_page=True)
        pg.emulate_media(media="screen")
        pg.click("#btnPrint"); settle(pg, 300)
        with pg.expect_download() as dl: pg.click("[data-do-export]")
        dl.value.save_as(f"{OUT}/104-export-with-notes.png"); settle(pg, 300)
        pg.context.close()
        # 没有中文语音：朗读按钮隐藏
        pg = new_page(b, 1000, 800)
        pg.add_init_script("Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => [], addEventListener() {}, cancel() {} }, configurable: true }); window.SpeechSynthesisUtterance = function () {};")
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 2200)
        results["v5_no_voice_hidden"] = pg.evaluate("document.getElementById('btnRead').hidden")
        pg.context.close()
        # 节令：清明、春节（农历）、霜降前后一天
        for d, label in (("2027-04-05", "qingming"), ("2026-02-17", "chunjie"), ("2026-10-24", "shuangjiang")):
            pg = new_page(b, 1000, 800)
            pg.goto(BASE + "?date=" + d); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1200)
            results["v5_season_" + label] = pg.inner_text(".poem-title").replace("\n", "") + " / " + pg.inner_text(".tagline")
            pg.context.close()
        # 手机：学习按钮、诗单、默写
        m = new_page(b, 390, 844, mobile=True)
        m.add_init_script(FAKE_TTS)
        m.goto(BASE); m.wait_for_selector(".poem-body ruby.c"); settle(m, 1600)
        m.evaluate("document.querySelector('.study').scrollIntoView({block: 'center'})"); settle(m, 300)
        m.screenshot(path=f"{OUT}/105-mobile-study.png")
        m.tap("#btnRead"); settle(m, 500); m.screenshot(path=f"{OUT}/106-mobile-read-sheet.png"); m.keyboard.press("Escape")
        m.tap("#btnBrowse"); settle(m, 600); m.tap('[data-bsel="t:春"]'); settle(m, 300)
        m.screenshot(path=f"{OUT}/107-mobile-browse.png")
        results["v5_mobile_browse"] = m.locator("#browseBody .res").count()
        m.context.close()

    if PART in ("all", "visual"):
        # ---- 字体 · 长诗导出 · 竖排方向 · 字号 ----
        def setting(page, sel):
            page.click("#btnSettings"); settle(page, 250); page.click(sel); settle(page, 1800); page.keyboard.press("Escape"); settle(page, 300)
        def fontinfo(page):
            return page.evaluate("""() => { const h = document.querySelector('.poem-body ruby.c .h');
              const fam = getComputedStyle(h).fontFamily.split(',')[0].replace(/"/g,'').trim();
              return { first: fam, loaded: document.fonts.check('40px "' + fam + '"', h.textContent), data: document.documentElement.dataset.font || 'fang' }; }""")
        def export(page, name):
            with page.expect_download() as dl:
                page.click("#btnImage")
            dl.value.save_as(f"{OUT}/{name}")
            settle(page, 300)
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 2600)
        results["font_default"] = fontinfo(pg); results["ov_default_h"] = overlaps(pg)
        pg.screenshot(path=f"{OUT}/30-font-fang-default-horizontal.png", full_page=True)
        setting(pg, '[data-font="kai"]')
        results["font_kai"] = fontinfo(pg); results["ov_kai_h"] = overlaps(pg)
        pg.screenshot(path=f"{OUT}/31-font-kai-horizontal.png", full_page=True)
        setting(pg, '[data-font="hei"]')
        results["font_hei"] = fontinfo(pg); results["ov_hei_h"] = overlaps(pg)
        pg.screenshot(path=f"{OUT}/32-font-hei-horizontal.png", full_page=True)
        pg.click("#btnSettings"); settle(pg, 300)
        pg.screenshot(path=f"{OUT}/34-settings-popover.png")
        pg.keyboard.press("Escape")
        setting(pg, '[data-font="song"]')
        pg.click('#modeSeg [data-mode="v"]'); settle(pg, 2000)
        results["ov_song_v"] = overlaps(pg)
        pg.screenshot(path=f"{OUT}/33-font-song-vertical.png", full_page=True)
        pg.click('#modeSeg [data-mode="g"]'); settle(pg, 1600)
        results["ov_song_g"] = overlaps(pg)
        pg.screenshot(path=f"{OUT}/35-font-song-tianzige.png", full_page=True)
        # 长诗：将进酒
        pg.click('#modeSeg [data-mode="h"]'); settle(pg, 500)
        pg.fill("#q", "将进酒"); pg.press("#q", "Enter"); settle(pg, 900)
        pg.click("#results .res >> nth=0"); settle(pg, 2400)
        results["jjj_title"] = pg.inner_text(".poem-title").replace("\n", "")
        for mode, label in (("h", "horizontal"), ("v", "vertical"), ("g", "tianzige")):
            pg.click(f'#modeSeg [data-mode="{mode}"]'); settle(pg, 1800)
            results["ov_jjj_" + mode] = overlaps(pg)
            export(pg, f"40-export-jiangjinjiu-{label}.png")
        pg.click('#modeSeg [data-mode="v"]'); settle(pg, 1600)
        pg.screenshot(path=f"{OUT}/41a-vertical-rtl.png", full_page=True)
        setting(pg, '[data-vdir="lr"]')
        results["vdir_class"] = pg.get_attribute("#poemView", "class")
        pg.screenshot(path=f"{OUT}/41b-vertical-ltr.png", full_page=True)
        export(pg, "41c-export-jiangjinjiu-vertical-ltr.png")
        pg.emulate_media(media="print"); settle(pg, 400)
        pg.screenshot(path=f"{OUT}/42-print-vertical-ltr.png", full_page=True)
        pg.emulate_media(media="screen")
        setting(pg, '[data-vdir="rl"]')
        pg.click('#modeSeg [data-mode="h"]'); settle(pg, 600)
        pg.context.close()

        m = new_page(b, 390, 844, mobile=True)
        m.goto(BASE); m.wait_for_selector(".poem-body ruby.c"); settle(m, 2400)
        setting(m, '[data-disp-size="xl"]')
        results["m_xl_cs"] = m.evaluate("getComputedStyle(document.getElementById('poemView')).getPropertyValue('--cs')")
        results["m_xl_wrap"] = m.get_attribute("#poemView", "class")
        results["ov_m_xl"] = overlaps(m)
        m.screenshot(path=f"{OUT}/50-mobile-xl-horizontal.png", full_page=True)
        m.click("#dMode"); settle(m, 1600)
        results["ov_m_xl_v"] = overlaps(m)
        m.screenshot(path=f"{OUT}/51-mobile-xl-vertical.png", full_page=True)
        m.click("#dMode"); settle(m, 1600)
        results["ov_m_xl_g"] = overlaps(m)
        m.screenshot(path=f"{OUT}/52-mobile-xl-tianzige.png", full_page=True)
        m.click("#dMode"); settle(m, 600)
        setting(m, '[data-disp-py="l"]'); setting(m, '[data-disp-lh="loose"]')
        results["ov_m_xl_pyl"] = overlaps(m)
        m.screenshot(path=f"{OUT}/53-mobile-xl-bigpinyin-loose.png", full_page=True)
        export(m, "54-export-mobile-xl.png")
        m.click("#btnSettings"); settle(m, 300)
        m.screenshot(path=f"{OUT}/55-mobile-settings-sheet.png")
        m.click("[data-reset-display]"); settle(m, 800); m.keyboard.press("Escape")
        results["m_after_reset"] = m.evaluate("[localStorage.getItem('yinshi:display'), getComputedStyle(document.getElementById('poemView')).getPropertyValue('--cs')]")
        m.context.close()
    if PART in ("all", "v6"):
        # ---- 第三批：诗人足迹地图、学习列表（多列表、粘贴诗名、练习、分享、打印）、旧诗单迁移、标签与印章正立 ----
        V6 = {}
        DAILYP = json.load(open(os.path.join(SITE, "poem", "daily-poems.json"), encoding="utf-8"))["poems"]
        def chk(name, ok, val=""):
            V6[name] = ("OK " if ok else "FAIL ") + str(val)[:160]
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 2000)
        # 标签与印章：不倾斜
        tilt = pg.evaluate("""() => [...document.querySelectorAll('.tag-today,.tag-src,.seal-img')].map(e => { const s = getComputedStyle(e); return s.fontStyle + '/' + s.transform; })""")
        chk("tags_upright", all(t in ("normal/none",) for t in tilt), tilt)
        logo = open(os.path.join(SITE, "assets", "logo.svg"), encoding="utf-8").read() + open(os.path.join(SITE, "favicon.svg"), encoding="utf-8").read()
        chk("logo_upright", "rotate(" not in logo and "skew" not in logo)
        # 地图：从「诗单 → 分类」进入，选苏轼
        before = len(calls)
        pg.click("#btnBrowse"); settle(pg, 500)
        pg.click('#browse [data-map="苏轼"]'); pg.wait_for_selector("#mapv:not([hidden]) .mv-seal"); settle(pg, 700)
        chk("map_lazy_files", pg.evaluate("performance.getEntriesByType('resource').filter(r => /map\\.js|footprints\\.json|rivers\\.json/.test(r.name)).length") == 3)
        nseal = pg.locator("#mapv .mv-seal").count(); chk("map_su_seals", nseal == 12, nseal)
        chk("map_su_route", pg.locator("#mapv .mv-route").count() == 1)
        chk("map_no_border", pg.evaluate("document.querySelectorAll('#mapv path').length") > 10 and pg.locator("#mapv .mv-river").count() >= 10, pg.locator("#mapv .mv-river").count())
        pg.screenshot(path=f"{OUT}/120-map-su-desktop.png")
        # 在地图上点黄州的朱印
        box = pg.locator('#mapv .mv-seal[data-place="huangzhou"] rect').bounding_box()
        chk("map_tap_target", box and box["width"] >= 14, box)
        pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2); settle(pg, 400)
        card = pg.inner_text("#mvCard")
        chk("map_huangzhou_card", "黄州" in card and "1080" in card and "初到黄州" in card, card.replace("\n", " ")[:120])
        pg.screenshot(path=f"{OUT}/121-map-su-huangzhou.png")
        pg.click('#mvCard [data-mv-open]:has-text("初到黄州")')
        pg.wait_for_function("() => document.getElementById('mapv').hidden && [...document.querySelectorAll('.poem-title .h')].map(x => x.textContent).join('').includes('初到黄州')", timeout=15000)
        settle(pg, 800)
        tt = pg.evaluate("[...document.querySelectorAll('.poem-title .h')].map(x => x.textContent).join('')")
        chk("map_open_poem", "初到黄州" in tt, tt)
        pg.screenshot(path=f"{OUT}/122-poem-from-map.png")
        # 总览：点杭州
        pg.goto(BASE + "#map"); pg.wait_for_selector("#mapv:not([hidden]) .mv-dot"); settle(pg, 700)
        chk("map_overview_dots", pg.locator("#mapv .mv-dot").count() >= 40, pg.locator("#mapv .mv-dot").count())
        pg.click('#mvList [data-mv-place="hangzhou"]'); settle(pg, 300)
        card = pg.inner_text("#mvCard")
        chk("map_overview_hangzhou", all(n in card for n in ("苏轼", "白居易", "陆游", "李清照")), card.replace("\n", " ")[:120])
        pg.screenshot(path=f"{OUT}/123-map-overview.png")
        pg.keyboard.press("Escape"); settle(pg, 300)
        chk("map_escape", pg.evaluate("document.getElementById('mapv').hidden"))
        # 作者侧栏「足迹」：打开课本诗《早发白帝城》（李白）
        pg.fill("#q", "早发白帝城"); settle(pg, 600)
        pg.click("#results .res >> nth=0"); settle(pg, 1200)
        pg.click('#sideAu [data-foot="李白"]'); pg.wait_for_selector("#mapv:not([hidden]) .mv-seal"); settle(pg, 500)
        chk("map_from_side", pg.locator('#mapv .mv-chips [aria-pressed="true"]').inner_text() == "李白" and pg.locator("#mapv .mv-seal").count() == 13)
        pg.click('#mvList [data-mv-place="kuizhou"]'); settle(pg, 300)
        chk("map_li_baidi", "早发白帝城" in pg.inner_text("#mvCard") and "759" in pg.inner_text("#mvCard"))
        pg.keyboard.press("Escape"); settle(pg, 200)
        pg.context.close()
        # 夜读 + 繁體
        pg = new_page(b, 1440, 1000)
        pg.add_init_script("localStorage.setItem('yinshi:theme', JSON.stringify('ye')); localStorage.setItem('yinshi:lang', JSON.stringify('hant'));")
        pg.goto(BASE + "#map=" + "%E8%BE%9B%E5%BC%83%E7%96%BE"); pg.wait_for_selector("#mapv:not([hidden]) .mv-seal"); settle(pg, 1500)
        chips = pg.inner_text("#mapv .mv-chips")
        chk("map_hant", "蘇軾" in chips and "辛棄疾" in chips, chips.replace("\n", " "))
        mbg = pg.evaluate("getComputedStyle(document.getElementById('mapv')).backgroundColor")
        chk("map_dark_under_ye", mbg == "rgb(23, 21, 17)", mbg)   # 夜读是唯一例外：整页变暗，地图页也是深色
        pg.click('#mvList [data-mv-place="jingkou"]'); settle(pg, 400)
        pg.screenshot(path=f"{OUT}/124-map-xin-ye-hant.png")
        pg.context.close()
        # 手机
        m = new_page(b, 390, 844, mobile=True)
        m.goto(BASE + "#map=%E6%9D%9C%E7%94%AB"); m.wait_for_selector("#mapv:not([hidden]) .mv-seal"); settle(m, 900)
        m.screenshot(path=f"{OUT}/125-map-du-mobile.png")
        m.tap('#mapv .mv-seal[data-place="kuizhou"] rect'); settle(m, 600)
        chk("map_mobile_tap", "登高" in m.inner_text("#mvCard"))
        tgt = m.evaluate("Math.min(...[...document.querySelectorAll('#mvList button, #mvCard button.mv-poem, .mv-chips .chip')].map(b => b.getBoundingClientRect().height))")
        chk("map_mobile_targets_40", tgt >= 40, tgt)
        m.screenshot(path=f"{OUT}/126-map-du-mobile-card.png", full_page=True)
        m.context.close()
        m = new_page(b, 390, 844, mobile=True)
        m.add_init_script("localStorage.setItem('yinshi:theme', JSON.stringify('ye'));")
        m.goto(BASE + "#map=%E6%9D%8E%E6%B8%85%E7%85%A7"); m.wait_for_selector("#mapv:not([hidden]) .mv-seal"); settle(m, 900)
        m.tap('#mvList [data-mv-place="jinhua"]'); settle(m, 500)
        chk("map_mobile_ye", "武陵春" in m.inner_text("#mvCard"))
        m.evaluate("document.getElementById('mapv').scrollTop = 0"); settle(m, 200)
        m.screenshot(path=f"{OUT}/127-map-li-qingzhao-mobile-ye.png")
        m.context.close()

        # ---- 学习列表 ----
        pg = new_page(b, 1440, 1000)
        # 旧版：只有收藏（yinshi:fav），没有 yinshi:lists
        old = {"静夜思|李白": {"p": {"title": "静夜思", "author": "李白", "dynasty": "唐", "lines": DAILYP[1]["lines"], "source": "daily", "dailyIndex": 1, "lang": "hans"}, "at": 1}}
        pg.add_init_script("if (!localStorage.getItem('yinshi:lists')) localStorage.setItem('yinshi:fav', " + json.dumps(json.dumps(old, ensure_ascii=False)) + ");")
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1500)
        pg.click("#btnBrowse"); settle(pg, 300); pg.click('#browse [data-tab="mine"]'); settle(pg, 300)
        mig = pg.inner_text("#browseBody .ls-list")
        chk("lists_migrated", "我的诗单" in mig and "1 首" in mig, mig.replace("\n", " "))
        chk("lists_fav_kept", "静夜思" in pg.evaluate("localStorage.getItem('yinshi:fav')"))
        pg.screenshot(path=f"{OUT}/130-lists-overview.png")
        # 新建列表 + 粘贴诗名
        pg.fill("[data-ls-new] input", "周三作业"); pg.click("[data-ls-new] button"); settle(pg, 300)
        pg.fill("[data-ls-paste] textarea", "春晓\n静夜思 李白\n不存在的诗名"); pg.click("[data-ls-paste] button[type=submit]")
        pg.wait_for_selector(".ls-match", timeout=20000); settle(pg, 300)
        mt = pg.inner_text(".ls-match")
        chk("lists_paste_match", mt.count("✓") == 2 and mt.count("✗") == 1, mt.replace("\n", " "))
        pg.screenshot(path=f"{OUT}/131-lists-paste-match.png")
        pg.click("[data-ls-addmatched]"); settle(pg, 300)
        chk("lists_two", pg.locator("#browseBody .ls-items li").count() == 2)
        pg.click("#browseClose"); settle(pg, 200)
        # 从搜索结果加入第三首
        pg.fill("#q", "咏鹅"); settle(pg, 600)
        pg.click("#results .res-add >> nth=0"); settle(pg, 300)
        pg.screenshot(path=f"{OUT}/132-addlist-pop.png")
        pg.click('#pop .al-item:has-text("周三作业")'); settle(pg, 300)
        pg.keyboard.press("Escape"); pg.keyboard.press("Escape"); settle(pg, 300)
        # 诗笺下方「加入列表」：当前诗加入「今日作业」
        pg.click("#btnAddList"); settle(pg, 300)
        chk("addlist_card_pop", pg.locator("#pop .al-item").count() >= 2)
        pg.keyboard.press("Escape"); settle(pg, 200)
        pg.click("#btnBrowse"); settle(pg, 300); pg.click('#browse [data-tab="mine"]'); settle(pg, 300)
        if pg.locator("[data-ls-back]").count(): pg.click("[data-ls-back]"); settle(pg, 200)
        pg.click('[data-ls-open]:has-text("周三作业")'); settle(pg, 300)
        titles = pg.eval_on_selector_all("#browseBody .ls-items .res-t", "e => e.map(x => x.innerText)")
        chk("lists_three", len(titles) == 3, titles)
        pg.click('[data-li-mv$="|1"] >> nth=0'); settle(pg, 200)
        titles2 = pg.eval_on_selector_all("#browseBody .ls-items .res-t", "e => e.map(x => x.innerText)")
        chk("lists_reorder", titles2[0][1:] == titles[1][1:], titles2)
        pg.screenshot(path=f"{OUT}/133-list-detail.png")
        # 分享链接
        pg.click("[data-ls-share]"); settle(pg, 300)
        url = pg.input_value("[data-share-url]")
        chk("share_url", "#list=" in url and "name=" in url, url)
        pg.keyboard.press("Escape"); settle(pg, 200)
        # 打印列表
        pg.click("[data-ls-print]"); settle(pg, 300)
        pg.evaluate("() => { window.print = () => { window.__printed = [document.body.className, document.getElementById('printList').innerText.slice(0, 80), document.querySelectorAll('#printList .pl-poem').length, document.querySelectorAll('#printList .pl-c i').length]; }; }")
        pg.click("[data-pl-go]"); settle(pg, 1200)
        pr = pg.evaluate("window.__printed")
        chk("print_list", pr and pr[2] == 3 and pr[3] > 20 and "print-listing" in pr[0], pr)
        pg.emulate_media(media="print"); settle(pg, 300)
        pg.screenshot(path=f"{OUT}/134-print-list.png", full_page=True)
        pg.emulate_media(media="screen"); pg.evaluate("document.body.classList.remove('print-listing')")
        # 练习：四步全走，第一首「再练」排到队尾，其余「已会」
        pg.click('[data-ls-practice]'); settle(pg, 300)
        pg.screenshot(path=f"{OUT}/135-practice-setup.png")
        pg.click("[data-pk-go]"); pg.wait_for_selector("#pbar:not([hidden]) .pb-steps"); settle(pg, 800)
        prog = []
        def run_poem(verdict):
            steps = []
            for i in range(4):
                steps.append(pg.inner_text("#pbar .pb-steps li.on"))
                if i < 3: pg.click("[data-pb-next]"); settle(pg, 500)
            veil_seen = steps[2] == "背诵"
            # 默写：按原诗填对所有空
            title = pg.evaluate("[...document.querySelectorAll('.poem-title .h')].map(x => x.textContent).join('')")
            d = next((p for p in DAILYP if re.sub(r"[（(].*?[）)]", "", p["t"]) in "".join(re.findall(r"[\u4e00-\u9fff]", title))), None)
            keys = pg.eval_on_selector_all(".poem-body ruby.blank", "e => e.map(x => x.dataset.k)")
            for k in keys:
                li, ci = map(int, k.split(":"))
                ch = list(d["lines"][li])[ci]
                pg.click(f'.poem-body ruby[data-k="{k}"]'); settle(pg, 120)
                pg.fill("#pop [data-dict-type] input", ch); pg.press("#pop [data-dict-type] input", "Enter"); settle(pg, 150)
            tip = pg.inner_text("#pbar .pb-tip")
            prog.append(pg.inner_text("#pbar [data-pb-prog]"))
            pg.click(f'[data-pb-verdict="{verdict}"]'); settle(pg, 900)
            return steps, veil_seen, len(keys), tip
        s1 = run_poem("again")
        chk("practice_steps", s1[0] == ["朗读", "跟读", "背诵", "默写"], s1[0])
        chk("practice_dict_full", "答对" in s1[3] and str(s1[2]) in s1[3], s1[3])
        chk("practice_requeue", "/ 4" in pg.inner_text("#pbar [data-pb-prog]"), pg.inner_text("#pbar [data-pb-prog]"))
        pg.screenshot(path=f"{OUT}/136-practice-bar.png")
        for _ in range(3): run_poem("ok")
        pg.wait_for_selector(".pmodal .ps-list"); settle(pg, 300)
        summ = pg.inner_text(".pmodal")
        chk("practice_summary", "已会" in summ and "再练 1 次" in summ, summ.replace("\n", " ")[:150])
        pg.screenshot(path=f"{OUT}/137-practice-summary.png")
        pg.check(".pmodal [data-ps-sched]"); pg.click(".pmodal [data-ps-done]"); settle(pg, 500)
        rec = pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('yinshi:recite') || '{}')).length")
        chk("practice_scheduled", rec == 3, rec)
        pg.click("#btnBrowse"); settle(pg, 300); pg.click('#browse [data-tab="mine"]'); settle(pg, 200)
        if pg.locator("[data-ls-back]").count(): pg.click("[data-ls-back]"); settle(pg, 200)
        chk("practice_checkin", "今天已打卡" in pg.inner_text("#browseBody .ls-list"))
        pg.context.close()
        # 分享链接在另一台设备打开：确认后导入
        m = new_page(b, 390, 844, mobile=True)
        m.goto(url.replace(re.match(r"https?://[^/]+/", url).group(0), BASE)); m.wait_for_selector(".pmodal [data-imp-go]", timeout=15000); settle(m, 400)
        m.screenshot(path=f"{OUT}/138-import-confirm-mobile.png")
        m.click(".pmodal [data-imp-go]"); m.wait_for_selector("#browse:not([hidden]) .ls-items", timeout=20000); settle(m, 500)
        imp = m.eval_on_selector_all("#browseBody .ls-items .res-t", "e => e.map(x => x.innerText)")
        chk("share_roundtrip", len(imp) == 3 and [x[1:] for x in imp] == [x[1:] for x in titles2], imp)
        chk("share_hash_cleared", "#list" not in m.url)
        m.screenshot(path=f"{OUT}/139-imported-list-mobile.png")
        m.context.close()
        results["v6"] = V6

    if PART in ("all", "v7"):
        # ---- 纸面与字体只作用于中间的诗笺，页面外框（顶栏、搜索、侧栏、背景）不变 ----
        V7 = {}
        def chk7(name, ok, val=""):
            V7[name] = ("ok" if ok else "FAIL") + (f" {val}" if val != "" else "")
        PROBE = """() => { const g = (sel, p) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[p] : null; };
          return { cardBg: g('#poem', 'backgroundColor'), cardImg: g('#poem', 'backgroundImage').slice(0, 60), cardHan: g('.poem-body ruby.c .h', 'fontFamily').split(',')[0],
                   cardInk: g('.poem-body ruby.c .h', 'color'), bodyBg: g('body', 'backgroundColor'), bodyImg: g('body', 'backgroundImage').slice(0, 60), htmlBg: g('html', 'backgroundColor'),
                   barBg: g('.topbar', 'backgroundImage'), brandFont: g('.brand-name', 'fontFamily').split(',')[0], searchFont: g('#q', 'fontFamily').split(',')[0],
                   searchBg: g('.search', 'backgroundColor'), bodyColor: g('body', 'color'), meta: document.querySelector('meta[name=theme-color]').content }; }"""
        def setting7(page, sel):
            page.click("#btnSettings"); settle(page, 250); page.click(sel); settle(page, 1500); page.keyboard.press("Escape"); settle(page, 600)
        V7OUT = os.environ.get("YINSHI_V7_OUT", OUT); os.makedirs(V7OUT, exist_ok=True)
        YE2 = os.environ.get("YINSHI_YE2_OUT", V7OUT); os.makedirs(YE2, exist_ok=True)
        # 夜读下找「诗笺外还亮着的」界面：可见元素背景色明亮且不透明，或文字是深色（深底上看不清）
        LIGHT_SCAN = """() => { const lum = (c) => { const m = (c.match(/[\\d.]+/g) || []).map(Number); if (m.length < 3) return null;
            const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
            return { l: .2126 * r + .7152 * g + .0722 * b, a: m.length > 3 ? m[3] : 1 }; };
          const skip = (e) => e.closest('.card, .theme-grid, .font-grid, .toast, .seal-img, svg, [hidden]');
          const out = [];
          for (const e of document.querySelectorAll('body *')) {
            if (skip(e)) continue;
            const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
            const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
            const bg = lum(cs.backgroundColor);
            if (bg && bg.a > .5 && bg.l > .4) out.push('bg ' + e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + [...e.classList].join('.') + ' ' + cs.backgroundColor);
            const txt = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            const fg = lum(cs.color);
            if (txt && fg && fg.l < .08 && !(bg && bg.a > .5 && (bg.l + .05) / (fg.l + .05) >= 3)) out.push('ink ' + e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + [...e.classList].join('.') + ' ' + cs.color);
          }
          return out.slice(0, 12); }"""
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 2200)
        d0 = pg.evaluate(PROBE)
        pg.screenshot(path=f"{V7OUT}/01-desktop-default.png")
        setting7(pg, '[data-theme-k="zhu"]'); setting7(pg, '[data-font="kai"]')
        d1 = pg.evaluate(PROBE)
        pg.screenshot(path=f"{V7OUT}/02-desktop-zhu-kai.png")
        chk7("zhu_card_bg_changed", d1["cardBg"] != d0["cardBg"], f'{d0["cardBg"]} -> {d1["cardBg"]}')
        chk7("kai_card_font_changed", d1["cardHan"] != d0["cardHan"] and "WenKai" in d1["cardHan"], f'{d0["cardHan"]} -> {d1["cardHan"]}')
        for k in ("bodyBg", "bodyImg", "htmlBg", "barBg", "brandFont", "searchFont", "searchBg", "bodyColor", "meta"):
            chk7("zhu_kai_same_" + k, d1[k] == d0[k], d1[k] if d1[k] != d0[k] else "")
        # 侧栏、搜索结果也不变
        pg.fill("#q", "春"); settle(pg, 900)
        chk7("results_font_default", "Zhuque" in pg.evaluate("getComputedStyle(document.querySelector('#results .res-t')).fontFamily.split(',')[0]"))
        pg.keyboard.press("Escape"); settle(pg, 300)
        setting7(pg, '[data-theme-k="ye"]')
        d2 = pg.evaluate(PROBE)
        pg.screenshot(path=f"{V7OUT}/03-desktop-ye-kai.png")
        chk7("ye_card_dark", d2["cardBg"] == "rgb(33, 30, 24)", d2["cardBg"])
        chk7("ye_card_ink_light", d2["cardInk"] == "rgb(236, 228, 211)", d2["cardInk"])
        # 夜读是唯一例外：整页一起变暗（背景、顶栏、搜索、地址栏颜色），字体仍只作用于诗笺
        chk7("ye_page_dark", d2["bodyBg"] == "rgb(23, 21, 17)", d2["bodyBg"])
        chk7("ye_bar_changed", d2["barBg"] != d0["barBg"], d2["barBg"][:60])
        chk7("ye_search_dark", d2["searchBg"] != d0["searchBg"], d2["searchBg"])
        chk7("ye_body_ink_light", d2["bodyColor"] == "rgb(236, 228, 211)", d2["bodyColor"])
        chk7("ye_meta_dark", d2["meta"] == "#171511", d2["meta"])
        for k in ("brandFont", "searchFont"):
            chk7("ye_font_same_" + k, d2[k] == d0[k], d2[k] if d2[k] != d0[k] else "")
        chk7("ye_card_font_still_kai", "WenKai" in d2["cardHan"], d2["cardHan"])
        bad = pg.evaluate(LIGHT_SCAN); chk7("ye_no_light_chrome_main", not bad, bad)
        pg.click("#btnSettings"); settle(pg, 400)
        bad = pg.evaluate(LIGHT_SCAN); chk7("ye_no_light_chrome_settings", not bad, bad)
        pg.screenshot(path=f"{YE2}/ye2-desktop-settings-popover.png")
        pg.keyboard.press("Escape"); settle(pg, 400)
        pg.screenshot(path=f"{YE2}/ye2-desktop-horizontal.png")
        pg.click('.poem-body ruby.c >> nth=2'); settle(pg, 600)
        bad = pg.evaluate(LIGHT_SCAN); chk7("ye_no_light_chrome_wordpop", not bad, bad)
        pg.screenshot(path=f"{YE2}/ye2-desktop-word-popover.png")
        pg.keyboard.press("Escape"); settle(pg, 300)
        pg.fill("#q", "春"); settle(pg, 900)
        bad = pg.evaluate(LIGHT_SCAN); chk7("ye_no_light_chrome_search", not bad, bad)
        pg.screenshot(path=f"{YE2}/ye2-desktop-search.png")
        pg.keyboard.press("Escape"); settle(pg, 300)
        pg.click("#btnBrowse"); settle(pg, 500)
        bad = pg.evaluate(LIGHT_SCAN); chk7("ye_no_light_chrome_browse", not bad, bad)
        pg.screenshot(path=f"{YE2}/ye2-desktop-browse.png")
        pg.keyboard.press("Escape"); settle(pg, 300)
        pg.click("#btnFilter"); settle(pg, 500)
        bad = pg.evaluate(LIGHT_SCAN); chk7("ye_no_light_chrome_filter", not bad, bad)
        pg.keyboard.press("Escape"); settle(pg, 300)
        pg.evaluate("document.getElementById('toast').textContent = '已复制'; document.getElementById('toast').classList.add('show')"); settle(pg, 400)
        tc = pg.evaluate("(() => { const c = getComputedStyle(document.getElementById('toast')); return [c.backgroundColor, c.color]; })()")
        chk7("ye_toast_visible", tc[0].startswith("rgba(236, 228, 211"), tc)
        pg.evaluate("document.getElementById('toast').classList.remove('show')"); settle(pg, 300)
        # 夜读诗笺里：田字格、遮字、平仄、改读音标记都看得清（对比度）
        pg.click('#modeSeg [data-mode="g"]'); settle(pg, 1500); pg.screenshot(path=f"{V7OUT}/04-desktop-ye-tianzige.png"); pg.screenshot(path=f"{YE2}/ye2-desktop-tianzige.png")
        pg.click('#modeSeg [data-mode="v"]'); settle(pg, 1500); pg.screenshot(path=f"{V7OUT}/05-desktop-ye-vertical.png")
        pg.click('#modeSeg [data-mode="h"]'); settle(pg, 1200)
        pg.click("#togVeil"); settle(pg, 800); pg.screenshot(path=f"{V7OUT}/06-desktop-ye-veil.png"); pg.click("#togVeil"); settle(pg, 600)
        with pg.expect_download() as dl: pg.click("#btnImage")
        dl.value.save_as(f"{V7OUT}/07-export-ye-kai.png"); settle(pg, 300)
        import shutil as _sh; _sh.copy(f"{V7OUT}/07-export-ye-kai.png", f"{YE2}/ye2-export.png")
        pg.emulate_media(media="print"); settle(pg, 300)
        pc = pg.evaluate("[getComputedStyle(document.querySelector('.poem-body ruby.c .h')).color, getComputedStyle(document.getElementById('poem')).backgroundColor]")
        chk7("print_ye_black_on_white", pc == ["rgb(31, 27, 22)", "rgb(255, 255, 255)"], pc)
        pg.emulate_media(media="screen")
        # 自定义背景：铺在诗笺上，不铺满页面
        import struct as _st, zlib as _zz
        def png7(w, h):
            raw = b"".join(b"\x00" + b"".join(bytes([40 + (x * 160 // w), 90 + (y * 100 // h), 170 - (x * 60 // w)]) for x in range(w)) for y in range(h))
            ck = lambda t, d: _st.pack(">I", len(d)) + t + d + _st.pack(">I", _zz.crc32(t + d) & 0xffffffff)
            return b"\x89PNG\r\n\x1a\n" + ck(b"IHDR", _st.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + ck(b"IDAT", _zz.compress(raw)) + ck(b"IEND", b"")
        open("/tmp/yinshi-bg7.png", "wb").write(png7(900, 600))
        pg.click("#btnSettings"); settle(pg, 300); pg.set_input_files("#bgFile", "/tmp/yinshi-bg7.png"); settle(pg, 1500); pg.keyboard.press("Escape"); settle(pg, 600)
        d3 = pg.evaluate(PROBE)
        chk7("custom_on_card", "blob:" in pg.evaluate("getComputedStyle(document.getElementById('poem')).backgroundImage"))
        chk7("custom_not_on_body", d3["bodyImg"] == d0["bodyImg"], d3["bodyImg"])
        pg.screenshot(path=f"{V7OUT}/08-desktop-custom.png")
        with pg.expect_download() as dl: pg.click("#btnImage")
        dl.value.save_as(f"{V7OUT}/09-export-custom.png"); settle(pg, 300)
        pg.context.close()
        # 夜读：地图页、学习列表也是深色；竹简：页面外框保持宣纸
        pg = new_page(b, 1440, 1000)
        pg.add_init_script("localStorage.setItem('yinshi:theme', JSON.stringify('ye'));")
        pg.goto(BASE + "#map=%E6%9D%8E%E7%99%BD"); pg.wait_for_selector("#mapv:not([hidden]) .mv-seal"); settle(pg, 1500)
        pg.click('#mvList [data-mv-place="kuizhou"]'); settle(pg, 400)
        chk7("ye_map_dark", pg.evaluate("getComputedStyle(document.getElementById('mapv')).backgroundColor") == "rgb(23, 21, 17)")
        bad = pg.evaluate(LIGHT_SCAN); chk7("ye_no_light_chrome_map", not bad, bad)
        pg.screenshot(path=f"{YE2}/ye2-desktop-map.png")
        pg.context.close()
        pg = new_page(b, 1440, 1000)
        pg.add_init_script("localStorage.setItem('yinshi:theme', JSON.stringify('zhu'));")
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 1800)
        dz = pg.evaluate(PROBE)
        for k in ("bodyBg", "bodyImg", "barBg", "searchBg", "bodyColor", "meta"):
            chk7("zhu_reload_same_" + k, dz[k] == d0[k], dz[k] if dz[k] != d0[k] else "")
        pg.screenshot(path=f"{YE2}/ye2-desktop-zhu.png")
        pg.goto(BASE + "#map=%E6%9D%8E%E7%99%BD"); pg.wait_for_selector("#mapv:not([hidden]) .mv-seal"); settle(pg, 1200)
        chk7("zhu_map_stays_xuan", pg.evaluate("getComputedStyle(document.getElementById('mapv')).backgroundColor") == "rgb(243, 237, 225)")
        pg.context.close()
        # 手机：竹简+楷、夜读；首屏前就套上（不闪）
        for name, th, fo in (("10-mobile-default", None, None), ("11-mobile-zhu-kai", "zhu", "kai"), ("12-mobile-ye", "ye", None)):
            m = new_page(b, 390, 844, mobile=True)
            init = ""
            if th: init += f"localStorage.setItem('yinshi:theme', JSON.stringify('{th}'));"
            if fo: init += f"localStorage.setItem('yinshi:font', JSON.stringify('{fo}'));"
            if init: m.add_init_script(init)
            m.goto(BASE); m.wait_for_selector(".poem-body ruby.c"); settle(m, 1800)
            dm = m.evaluate(PROBE)
            if th == "ye":
                chk7(name + "_page_dark", dm["bodyBg"] == "rgb(23, 21, 17)" and dm["searchFont"] == d0["searchFont"] and dm["meta"] == "#171511", [dm["bodyBg"], dm["meta"]])
                bad = m.evaluate(LIGHT_SCAN); chk7(name + "_no_light_chrome", not bad, bad)
            elif th: chk7(name + "_page_same", dm["bodyBg"] == "rgb(243, 237, 225)" and dm["searchFont"] == d0["searchFont"] and dm["meta"] == "#f3ede1", dm["bodyBg"])
            m.screenshot(path=f"{V7OUT}/{name}.png")
            if th == "zhu": m.screenshot(path=f"{YE2}/ye2-mobile-zhu-kai.png")
            if th == "ye":
                m.screenshot(path=f"{YE2}/ye2-mobile-horizontal.png")
                for _ in range(4):
                    if m.locator(".poem.m-g").count(): break
                    m.tap("#dMode"); settle(m, 900)
                settle(m, 1500)
                chk7("mobile_ye_tianzige", m.locator(".poem.m-g").count() > 0)
                m.screenshot(path=f"{YE2}/ye2-mobile-tianzige.png")
                m.tap('.poem-body ruby.c >> nth=1'); settle(m, 700)
                bad = m.evaluate(LIGHT_SCAN); chk7("mobile_ye_no_light_chrome_pop", not bad, bad)
                m.screenshot(path=f"{YE2}/ye2-mobile-word-popover.png")
                m.keyboard.press("Escape"); settle(m, 300)
                m.click("#btnSettings"); settle(m, 500)
                bad = m.evaluate(LIGHT_SCAN); chk7("mobile_ye_no_light_chrome_settings", not bad, bad)
                m.screenshot(path=f"{YE2}/ye2-mobile-settings.png")
                m.keyboard.press("Escape"); settle(m, 300)
                m.tap("#dSearch"); settle(m, 500); m.fill("#q2", "春"); settle(m, 1000)
                bad = m.evaluate(LIGHT_SCAN); chk7("mobile_ye_no_light_chrome_sheet", not bad, bad)
                m.screenshot(path=f"{YE2}/ye2-mobile-search-sheet.png")
                m.goto(BASE + "#map=%E6%9D%8E%E6%B8%85%E7%85%A7"); m.wait_for_selector("#mapv:not([hidden]) .mv-seal"); settle(m, 900)
                m.tap('#mvList [data-mv-place="jinhua"]'); settle(m, 500); m.evaluate("document.getElementById('mapv').scrollTop = 0"); settle(m, 200)
                bad = m.evaluate(LIGHT_SCAN); chk7("mobile_ye_no_light_chrome_map", not bad, bad)
                m.screenshot(path=f"{YE2}/ye2-mobile-map.png")
            m.context.close()
        results["v7"] = V7
    b.close()

results["api_calls"] = calls
results["errors"] = errors
print(json.dumps(results, ensure_ascii=False, indent=1))
bad6 = [k for k, v in results.get("v6", {}).items() if v.startswith("FAIL")]
if bad6: print("V6 FAIL:", bad6); sys.exit(1)
bad7 = [k for k, v in results.get("v7", {}).items() if v.startswith("FAIL")]
if bad7: print("V7 FAIL:", bad7); sys.exit(1)
