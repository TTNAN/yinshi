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
# 分段运行：YINSHI_PART=base（基本验收）、v3（诗人搜索/筛选、备用实例、设置按钮、简繁）或 visual（字体、长诗导出、竖排方向、字号）；默认全部
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
          const probe = document.createElement('i'); probe.style.color = cs.getPropertyValue('--grid'); document.body.appendChild(probe); const grid = getComputedStyle(probe).color; probe.remove();
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
    b.close()

results["api_calls"] = calls
results["errors"] = errors
print(json.dumps(results, ensure_ascii=False, indent=1))
