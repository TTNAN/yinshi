"""吟诗 · 无头浏览器验收（用录好的 API 响应模拟诗泉，不访问真实接口）

用法：python3 tests/e2e.py [截图输出目录]
"""
import json, os, re, sys, threading, functools, http.server
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, "..", "site")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "screens")
os.makedirs(OUT, exist_ok=True)
FX = json.load(open(os.path.join(HERE, "fixtures", "api.json"), encoding="utf-8"))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=SITE))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_address[1]}/"

calls, errors, results = [], [], {}
# 模拟两种诗库：public = 公共实例现状（搜索至少 3 个字、/poems 忽略 author）；
# selfhost = 自建实例（1–2 字可搜、/poems?author= 列出作者的诗）
MODE = {"api": "public"}
# 分段运行：YINSHI_PART=base（原有验收 + 搜索）或 visual（字体、长诗导出、竖排方向、字号）；默认全部
PART = os.environ.get("YINSHI_PART", "all")

def mock(route):
    u = urlparse(route.request.url); q = parse_qs(u.query); calls.append(route.request.url)
    H = {"access-control-allow-origin": "*", "content-type": "application/json"}
    if u.path.endswith("/search"):
        key = q.get("q", [""])[0]
        if len(key) < 3 and MODE["api"] == "public":
            return route.fulfill(status=400, headers=H, body=json.dumps({"error": {"code": "BAD_REQUEST", "message": "q must be at least 3 characters"}}))
        body = {"data": FX["search"].get(key, []), "pagination": {"page": 1, "pageSize": 20, "hasMore": False}}
    elif u.path.endswith("/poems"):
        page = int(q.get("page", ["1"])[0])
        if MODE["api"] == "public":
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

def new_page(browser, w, h, mobile=False):
    ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if mobile else 1,
                              is_mobile=mobile, has_touch=mobile, accept_downloads=True, locale="zh-CN")
    page = ctx.new_page()
    page.route(re.compile(r"https://poetry\.palemoky\.com/.*"), mock)
    page.route(re.compile(r"https://(cdn\.jsdelivr\.net|fonts\.googleapis\.cn|fonts\.gstatic\.cn)/.*"), cdn)
    page.on("console", lambda m: m.type in ("error", "warning") and errors.append(f"{w}: {m.type}: {m.text} @ {m.location.get('url','')}"))
    page.on("requestfailed", lambda r: errors.append(f"{w}: requestfailed: {r.url[:90]}"))
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

        # ---- 搜索：自建实例能力（1–2 字、作者诗目） ----
        MODE["api"] = "selfhost"
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 800)
        pg.fill("#q", "李白"); pg.press("#q", "Enter"); settle(pg, 1200)
        results["sh_libai_section"] = pg.eval_on_selector_all("#results .res-sec", "els => els.map(e => e.textContent)")
        results["sh_libai_first"] = pg.eval_on_selector_all("#results .res-t", "els => els.slice(0, 4).map(e => e.textContent)")
        results["sh_libai_status"] = pg.inner_text("#sheetStatus")
        pg.screenshot(path=f"{OUT}/20-search-libai-selfhost.png")
        pg.click("[data-more-author]"); settle(pg, 900)
        results["sh_libai_after_more"] = pg.locator("#results .res").count()
        results["sh_libai_more_left"] = pg.locator("[data-more-author]").count()
        pg.fill("#q", "月"); pg.press("#q", "Enter"); settle(pg, 1200)
        results["sh_yue_titles"] = pg.eval_on_selector_all("#results .res-t", "els => els.map(e => e.textContent)")
        results["sh_yue_status"] = pg.inner_text("#sheetStatus")
        pg.screenshot(path=f"{OUT}/21-search-yue-selfhost.png")
        pg.context.close()

        # ---- 搜索：公共实例现状（应平稳降级） ----
        MODE["api"] = "public"
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 800)
        pg.fill("#q", "李白"); pg.press("#q", "Enter"); settle(pg, 1200)
        results["pub_libai_status"] = pg.inner_text("#sheetStatus")
        results["pub_libai_sections"] = pg.locator("#results .res-sec").count()
        results["pub_libai_results"] = pg.eval_on_selector_all("#results .res-t", "els => els.map(e => e.textContent)")
        pg.screenshot(path=f"{OUT}/22-search-libai-public.png")
        n0 = len(calls)
        pg.fill("#q", "月"); pg.press("#q", "Enter"); settle(pg, 900)
        results["pub_yue_status"] = pg.inner_text("#sheetStatus")
        results["pub_yue_calls_after_probe"] = len(calls) - n0   # 已探测到不支持，应为 0
        pg.context.close()

    if PART in ("all", "visual"):
        # ---- 字体 · 长诗导出 · 竖排方向 · 字号 ----
        def setting(page, sel):
            page.click("#btnSettings"); settle(page, 250); page.click(sel); settle(page, 1800); page.keyboard.press("Escape"); settle(page, 300)
        def fontinfo(page):
            return page.evaluate("""() => { const h = document.querySelector('.poem-body ruby.c .h');
              const fam = getComputedStyle(h).fontFamily.split(',')[0].replace(/"/g,'').trim();
              return { first: fam, loaded: document.fonts.check('40px "' + fam + '"', h.textContent), data: document.documentElement.dataset.font || 'song' }; }""")
        def export(page, name):
            with page.expect_download() as dl:
                page.click("#btnImage")
            dl.value.save_as(f"{OUT}/{name}")
            settle(page, 300)
        pg = new_page(b, 1440, 1000)
        pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c"); settle(pg, 2600)
        results["font_song"] = fontinfo(pg); results["ov_song_h"] = overlaps(pg)
        pg.screenshot(path=f"{OUT}/30-font-song-horizontal.png", full_page=True)
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
