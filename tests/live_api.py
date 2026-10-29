"""真实接口检查：主诗库（snowtraces/poetry-source）与备用（诗泉 palemoky）返回的结构是否和 api.js 的预期一致，
并检查跨域头：浏览器要求 Access-Control-Allow-Origin 恰好一个，重复或缺失都会让页面的请求全部失败。
会访问网络。用法：python3 tests/live_api.py"""
import json, sys, time, urllib.request, urllib.parse

ORIGIN = "https://ttnan.github.io"
def get(base, path, **p):
    qs = urllib.parse.urlencode(p, doseq=True)
    req = urllib.request.Request(f"{base}{path}" + (f"?{qs}" if qs else ""), headers={"User-Agent": "Mozilla/5.0 Chrome/124", "Origin": ORIGIN})
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.load(r), r.headers.get_all("Access-Control-Allow-Origin") or []
    except urllib.error.HTTPError as e:
        raw = e.read(); acao = e.headers.get_all("Access-Control-Allow-Origin") or []
        try: return e.code, json.loads(raw or b"{}"), acao
        except Exception: return e.code, {"raw": raw[:120].decode("utf8", "replace")}, acao

checks = []
def ck(name, ok, info=""): checks.append((name, ok, info)); time.sleep(0.4)
def cors(name, acao): ck(name + " · CORS 单个 ACAO", len(acao) == 1 and acao[0] in ("*", ORIGIN), acao)

S = "https://poetry-api.snowtraces.com/v1"
s, b, h = get(S, "/authors", q="李白"); cors("snowtraces authors", h)
libai = (b.get("data") or [{}])[0].get("id")
ck("authors?q=李白 → id", s == 200 and libai and b["data"][0]["name"] == "李白", libai)
s, b, h = get(S, f"/authors/{libai}/works", page_size=50); cors("snowtraces author works", h)
ck("author works 李白", s == 200 and all(x["authorName"] == "李白" for x in b["data"]) and "next_cursor" in b["meta"], (len(b["data"]), b["meta"]))
sid = get(S, "/authors", q="苏轼")[1]["data"][0]["id"]
s, b, h = get(S, f"/authors/{sid}/works", page_size=50)
ck("author works 苏轼 has next_cursor", s == 200 and b["meta"]["next_cursor"], b["meta"])
s2, b2, _ = get(S, f"/authors/{sid}/works", page_size=50, cursor=b["meta"]["next_cursor"])
ck("author works 苏轼 page 2", s2 == 200 and b2["data"] and b2["data"][0]["id"] != b["data"][0]["id"], len(b2["data"]))
s, b, h = get(S, "/works", q="静夜思", page_size=30); cors("snowtraces works search", h)
ck("works?q=静夜思", s == 200 and isinstance(b["data"], list) and {"id", "title", "authorName", "dynasty", "content", "type"} <= set((b["data"] or [{}])[0]), len(b["data"]))
s, b, h = get(S, "/works", q="月"); ck("works?q=月 → 400 QUERY_TOO_SHORT (page uses palemoky char random instead)", s == 400, (b.get("error") or {}).get("code"))
s, b, h = get(S, "/works/random", author_id=libai); cors("snowtraces random", h)
ck("random author_id=李白", s == 200 and b["data"]["authorName"] == "李白", b["data"].get("title"))
s, b, h = get(S, "/works/random", type="ci", dynasty="宋"); ck("random type=ci dynasty=宋", s == 200 and b["data"]["type"] == "ci", b["data"].get("title"))
s, b, h = get(S, "/dynasties"); ck("dynasties", s == 200 and "唐" in b["data"], b["data"])
# 资料现状（只提示，不算失败）：主诗库目前缺多数唐诗、宋诗，页面在这些情况会改从备用诗库随机
s, b, h = get(S, "/works/random", type="poetry", dynasty="唐"); ck("info: random 唐 poetry (404 = 主诗库缺唐诗)", True, s)
dufu = get(S, "/authors", q="杜甫")[1]["data"]
s, b, h = get(S, f"/authors/{dufu[0]['id']}/works", page_size=5) if dufu else (0, {"data": []}, [])
ck("info: 杜甫 works in snowtraces", True, len(b.get("data") or []))

P = "https://poetry.palemoky.com/api"
s, b, h = get(P, "/poems/random", lang="zh-Hans"); cors("palemoky random", h); ck("fallback palemoky random {data}", s == 200 and "data" in b, s)
s, b, h = get(P, "/poems/random", char="月", lang="zh-Hans"); ck("palemoky random char=月", s == 200 and "月" in "".join(b["data"]["content"] + [b["data"]["title"]]), b["data"].get("title"))
s, b, h = get(P, "/poems/random", author="杜甫", lang="zh-Hans"); ck("palemoky random author=杜甫", s == 200 and b["data"]["author"]["name"] == "杜甫", b["data"].get("title"))
s, b, h = get(P, "/search", q="静夜思", page=1, lang="zh-Hans"); cors("palemoky search", h); ck("fallback palemoky search 3ch", s == 200, (s, b.get("pagination")))
s, b, h = get(P, "/poems/random", lang="zh-Hant"); ck("fallback palemoky zh-Hant", s == 200, (s, (b.get("data") or {}).get("title")))

# 全唐诗 / 全宋诗（chinese-poetry）：浏览器直连的 CDN（unpkg 为主，raw.githubusercontent.com 备用）
import urllib.request as _u
CP = ["https://unpkg.com/chinese-poetry@2.0.1/dist/quantangshi/poet.tang.8000.json",
      "https://raw.githubusercontent.com/chinese-poetry/chinese-poetry/b8594f81a89752241442f2ce267d6f66f96704ee/%E5%85%A8%E5%94%90%E8%AF%97/poet.tang.8000.json"]
for u in CP:
    try:
        with _u.urlopen(_u.Request(u, headers={"User-Agent": "Mozilla/5.0 Chrome/124", "Origin": ORIGIN}), timeout=30) as r:
            data = json.load(r); acao = r.headers.get_all("Access-Control-Allow-Origin") or []
            ck("cp CDN " + u.split("/")[2], r.status == 200 and len(data) >= 997 and data[118]["title"] == "靜夜思" and data[118]["author"] == "李白", (r.status, len(data)))
            cors("cp CDN " + u.split("/")[2], acao)
    except Exception as e:
        ck("cp CDN " + u.split("/")[2], False, e)

for c in checks: print("OK  " if c[1] else "FAIL", c[0], "|", str(c[2])[:150])
sys.exit(0 if all(c[1] for c in checks) else 1)
