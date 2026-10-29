"""吟诗 · 真实浏览器联网检查：不拦截任何请求，页面跨域直连真实诗库（和线上一样）。

用法：python3 tests/live_browser.py [网址]      默认在本地起一个 http 服务器托管 site/
      YINSHI_CHROMIUM=/usr/bin/chromium 可指定浏览器；有 HTTPS_PROXY 环境变量时浏览器走该代理。
检查：搜「李白」→ 诗人一节载入、加载更多；诗人浮层「更多 / 随机一首」；筛选 诗人=苏轼 随机；单字「月」；繁體。
"""
import json, os, sys, threading, functools, http.server
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, "..", "site")
OUT = os.environ.get("YINSHI_SHOTS")
if len(sys.argv) > 1:
    BASE = sys.argv[1]
else:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=SITE))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    BASE = f"http://127.0.0.1:{srv.server_address[1]}/"

def proxy():
    u = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if not u: return None
    p = urlparse(u)
    d = {"server": f"{p.scheme}://{p.hostname}:{p.port}", "bypass": "127.0.0.1,localhost"}
    if p.username: d.update(username=p.username, password=p.password or "")
    return d

R, api, bad = {}, [], []
def shot(pg, name):
    if OUT: os.makedirs(OUT, exist_ok=True); pg.screenshot(path=os.path.join(OUT, name))
def wait_status(pg, ms=15000):
    pg.wait_for_function("() => !document.querySelector('#sheetStatus .loading')", timeout=ms)
    pg.wait_for_timeout(300)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("YINSHI_CHROMIUM") or None, proxy=proxy())
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, locale="zh-CN")
    pg = ctx.new_page()
    def on_resp(r):
        if "snowtraces" in r.url or "palemoky" in r.url or "chinese-poetry" in r.url:
            api.append([r.status, r.url[:120], r.headers.get("access-control-allow-origin")])
    pg.on("response", on_resp)
    pg.on("requestfailed", lambda r: ("snowtraces" in r.url or "palemoky" in r.url or "chinese-poetry" in r.url) and bad.append("failed " + r.url[:120] + " " + str(r.failure)))
    pg.on("console", lambda m: m.type == "error" and bad.append("console " + m.text[:160]))
    pg.goto(BASE); pg.wait_for_selector(".poem-body ruby.c", timeout=30000); pg.wait_for_timeout(800)
    R["first_load_api_calls"] = len(api)

    # 全唐诗：李白的诗 ≥ 100 首、加载更多不重复；随机一首李白是唐诗；静夜思、春望能找到
    pg.fill("#q", "李白"); pg.press("#q", "Enter"); wait_status(pg, 40000)
    for _ in range(2):
        n0 = pg.locator("#results .res").count()
        pg.click("[data-more-author]"); pg.wait_for_function(f"() => document.querySelectorAll('#results .res').length > {n0}", timeout=40000); pg.wait_for_timeout(300)
    keys = pg.eval_on_selector_all("#results .res-sec-au ~ li .res", "e => e.map(x => x.innerText.replace(/\\s+/g, ''))")
    R["cp_libai"] = [len(keys), len(set(keys)), pg.locator("[data-more-author]").count(), pg.inner_text("#results .res-sec-au")]
    shot(pg, "live-cp-libai.png")
    pg.click("#results .res-sec-au ~ li .res >> nth=5"); pg.wait_for_timeout(1500)
    R["cp_libai_open"] = pg.inner_text(".poem-meta") + " / " + pg.inner_text(".poem-title").replace("\n", "")[:40]
    t0 = pg.inner_text(".poem-title")
    pg.click("#poemView .meta-au"); pg.wait_for_timeout(300); pg.click("[data-author-rand]")
    pg.wait_for_function("t => document.querySelector('.poem-title').innerText !== t", arg=t0, timeout=30000); pg.wait_for_timeout(600)
    R["cp_libai_rand"] = pg.inner_text(".poem-meta") + " / " + pg.inner_text(".poem-title").replace("\n", "")[:40]
    pg.fill("#q", "杜甫"); pg.press("#q", "Enter"); wait_status(pg, 40000)
    R["cp_dufu"] = [pg.locator("#results .res-sec-au ~ li .res").count(), pg.inner_text("#results .res-sec-au")]
    for q in ("静夜思", "春望", "将进酒"):
        pg.fill("#q", q); pg.press("#q", "Enter"); wait_status(pg, 40000)
        R["cp_title_" + q] = pg.eval_on_selector_all("#results .res", "e => e.slice(0, 2).map(x => x.innerText.split('\\n').slice(0, 2).join(' / '))")
    pg.click("#results .res >> nth=0"); pg.wait_for_timeout(1500)
    R["side_note_jjj"] = pg.inner_text("#sideNoteBody")[:30]
    pg.keyboard.press("Escape")

    pg.fill("#q", "李白"); pg.press("#q", "Enter"); wait_status(pg)
    R["libai_sections"] = pg.eval_on_selector_all("#results .res-sec", "e => e.map(x => x.textContent)")
    R["libai_count"] = pg.locator("#results .res").count()
    R["libai_status"] = pg.inner_text("#sheetStatus")
    shot(pg, "live-libai.png")
    n0 = R["libai_count"]
    R["libai_more_button"] = pg.locator("[data-more-author]").count() > 0   # 主诗库目前只收了李白 9 首词，可能没有「加载更多」
    # 「加载更多」用作品多的苏轼验证游标分页
    pg.fill("#q", "苏轼"); pg.press("#q", "Enter"); wait_status(pg)
    n0 = pg.locator("#results .res").count()
    pg.click("[data-more-author]"); pg.wait_for_function(f"() => document.querySelectorAll('#results .res').length > {n0}", timeout=15000)
    R["sushi_more"] = [n0, pg.locator("#results .res").count()]
    pg.fill("#q", "李白"); pg.press("#q", "Enter"); wait_status(pg)

    pg.click("#results .res-sec-au ~ li .res >> nth=0"); pg.wait_for_timeout(1200)
    R["opened"] = pg.inner_text(".poem-meta")
    pg.click("#poemView .meta-au"); pg.wait_for_timeout(300)
    pg.click("[data-author-more]"); wait_status(pg)
    R["more_author_sections"] = pg.eval_on_selector_all("#results .res-sec", "e => e.map(x => x.textContent)")
    pg.click("#results .res-sec-au ~ li .res >> nth=1"); pg.wait_for_timeout(1200)
    R["more_author_opened"] = pg.inner_text(".poem-title").replace("\n", "") + " / " + pg.inner_text(".poem-meta")
    t0 = pg.inner_text(".poem-title")
    pg.click("#poemView .meta-au"); pg.wait_for_timeout(300)
    pg.click("[data-author-rand]"); pg.wait_for_function("t => document.querySelector('.poem-title').innerText !== t", arg=t0, timeout=15000); pg.wait_for_timeout(600)
    R["rand_author_opened"] = pg.inner_text(".poem-title").replace("\n", "") + " / " + pg.inner_text(".poem-meta")

    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    pg.click("#btnFilter"); pg.wait_for_timeout(1500)
    shot(pg, "live-filter.png")
    R["dyn_chips"] = pg.eval_on_selector_all("#chipsDyn .chip", "e => e.map(x => x.textContent)")
    R["type_chips"] = pg.eval_on_selector_all("#chipsType .chip", "e => e.map(x => x.textContent)")
    pg.click('[data-poet="苏轼"]'); t0 = pg.inner_text(".poem-title")
    pg.click("#btnFilterGo"); pg.wait_for_function("t => document.querySelector('.poem-title').innerText !== t", arg=t0, timeout=15000); pg.wait_for_timeout(600)
    R["filter_sushi"] = pg.inner_text(".poem-title").replace("\n", "") + " / " + pg.inner_text(".poem-meta")
    if not pg.locator("#drawer").is_visible(): pg.click("#btnFilter"); pg.wait_for_timeout(400)
    pg.click('[data-poet="苏轼"]'); pg.click("#btnFilter")     # 取消诗人筛选

    pg.fill("#q", "将进酒"); pg.press("#q", "Enter"); wait_status(pg)
    R["jjj_results"] = pg.eval_on_selector_all("#results .res", "e => e.slice(0, 4).map(x => x.innerText.split('\\n').slice(0, 2).join(' / '))")
    pg.fill("#q", "月"); pg.press("#q", "Enter"); wait_status(pg, 30000)
    R["yue_titles"] = pg.eval_on_selector_all("#results .res-t", "e => e.map(x => x.textContent)")
    R["yue_status"] = pg.inner_text("#sheetStatus")
    shot(pg, "live-yue.png")
    pg.keyboard.press("Escape")

    pg.click("#btnSettings"); pg.wait_for_timeout(250); pg.click('[data-lang="hant"]'); pg.wait_for_timeout(2500); pg.keyboard.press("Escape")
    pg.fill("#q", "蘇軾"); pg.press("#q", "Enter"); wait_status(pg)
    R["hant_sushi_sections"] = pg.eval_on_selector_all("#results .res-sec", "e => e.map(x => x.textContent)")
    R["hant_sushi_first"] = pg.eval_on_selector_all("#results .res-t", "e => e.slice(0, 4).map(x => x.textContent)")
    pg.click("#results .res-sec-au ~ li .res >> nth=0"); pg.wait_for_timeout(1200)
    R["hant_opened"] = pg.inner_text(".poem-title").replace("\n", "") + " / " + pg.inner_text(".poem-meta")
    shot(pg, "live-hant.png")
    # 手机
    m = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="zh-CN").new_page()
    m.on("console", lambda x: x.type == "error" and bad.append("m console " + x.text[:160]))
    m.goto(BASE); m.wait_for_selector(".poem-body ruby.c", timeout=30000); m.wait_for_timeout(800)
    m.click("#dSearch"); m.fill("#q2", "李白"); m.press("#q2", "Enter"); wait_status(m, 40000)
    R["m_libai"] = m.locator("#results .res").count()
    shot(m, "live-m-libai.png")
    m.click("#results .res-sec-au ~ li .res >> nth=2"); m.wait_for_timeout(1500)
    R["m_open"] = m.inner_text(".poem-meta")
    R["m_side_collapsed"] = m.evaluate("getComputedStyle(document.getElementById('sideAuBody')).display")
    shot(m, "live-m-poem.png")
    b.close()

acao = [a for a in api if a[2] != "*"]
R["api_responses"] = len(api)
R["api_hosts"] = sorted({urlparse(a[1]).netloc for a in api})
R["api_non200"] = [a for a in api if a[0] != 200]
R["bad_acao"] = acao
R["errors"] = bad
print(json.dumps(R, ensure_ascii=False, indent=1))
ok = (not bad and not acao and R["sushi_more"][1] > R["sushi_more"][0] and "poetry-api.snowtraces.com" in R["api_hosts"]
      and R["cp_libai"][0] >= 100 and R["cp_libai"][0] == R["cp_libai"][1] and "唐" in R["cp_libai_rand"] and "李白" in R["cp_libai_rand"]
      and any("李白" in x for x in R["cp_title_静夜思"]) and any("杜甫" in x for x in R["cp_title_春望"]) and R["cp_dufu"][0] >= 40)
print("LIVE BROWSER:", "OK" if ok else "FAIL")
sys.exit(0 if ok else 1)
