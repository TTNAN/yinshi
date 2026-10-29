"""真实接口检查：诗泉公共实例返回的结构是否和 api.js 的预期一致（会访问网络）。用法：python3 tests/live_api.py"""
import json, urllib.request, urllib.parse, time
def get(base, path, **p):
    qs = urllib.parse.urlencode(p, doseq=True)
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{base}{path}?{qs}", headers={"User-Agent": "Mozilla/5.0 Chrome/124"}), timeout=20) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        raw=e.read()
        try: return e.code, json.loads(raw or b"{}")
        except Exception: return e.code, {"raw": raw[:120].decode("utf8","replace")}
B="https://poetry.llmaix.com/api/v1"
checks=[]
def ck(name, ok, info=""): checks.append((name, ok, info)); time.sleep(0.3)
s,b=get(B,"/poems/random",lang="zh-Hans"); ck("random direct poem", s==200 and isinstance(b.get("content"),list) and "data" not in b, b.get("title"))
s,b=get(B,"/poems/random",author="李白",lang="zh-Hans"); ck("random author=李白", s==200 and b["author"]["name"]=="李白", b.get("title"))
s,b=get(B,"/poems/random",author="蘇軾",lang="zh-Hant"); ck("random author=蘇軾 zh-Hant", s==200 and b["author"]["name"]=="蘇軾", b.get("title"))
s,b=get(B,"/poems/random",dynasty="唐",type=["五言绝句","七言绝句"],lang="zh-Hans"); ck("random dynasty+types", s==200 and b["dynasty"]["name"]=="唐" and b["type"]["name"] in ("五言绝句","七言绝句"), (b.get("title"),b.get("type",{}).get("name")))
s,b=get(B,"/poems/random",dynasty="宋",type=["宋詞"],lang="zh-Hant"); ck("random 宋/宋詞 zh-Hant", s==200, (s,b.get("title")))
s,b=get(B,"/poems/random",char="春"); ck("random char", s==200 and "春" in "".join(b["content"]+[b["title"]]), b.get("title"))
s,b=get(B,"/poems/random",author="不存在的人"); ck("random unknown author 404", s==404, b)
s,b=get(B,"/poems/search",q="月",page=1,page_size=30,lang="zh-Hans"); ck("search 1-char", s==200 and len(b["data"])==30 and {"page","total","total_pages"}<=set(b["pagination"]), b["pagination"])
s,b=get(B,"/poems/search",q="李白",type="author",page=1,page_size=50,lang="zh-Hans"); ck("search author 李白", s==200 and all(x["author"]["name"]=="李白" for x in b["data"]), b["pagination"])
s,b=get(B,"/poems/search",q="李白",type="author",page=b["pagination"]["total_pages"],page_size=50,lang="zh-Hans"); ck("search author last page", s==200 and len(b["data"])>0, (len(b["data"]), b["pagination"]))
s,b=get(B,"/poems/search",q="李白",type="author",page=1,page_size=50,lang="zh-Hant"); ck("search author zh-Hant 李白", s==200 and b["pagination"]["total"]>1000, b["pagination"])
s,b=get(B,"/poems/search",q="陸游",type="author",page=1,page_size=5,lang="zh-Hant"); ck("search author 陸游 zh-Hant (info: 繁体库收录不全，页面按诗人列诗时改用简体库)", s==200, b["pagination"])
s,b=get(B,"/dynasties",lang="zh-Hans"); ck("dynasties", s==200 and isinstance(b.get("data"),list), [x["name"] for x in b["data"]])
s,b=get(B,"/types",lang="zh-Hans"); ck("types", s==200 and isinstance(b.get("data"),list), len(b["data"]))
P="https://poetry.palemoky.com/api"
s,b=get(P,"/poems/random",lang="zh-Hans"); ck("fallback palemoky random {data}", s==200 and "data" in b, s)
s,b=get(P,"/search",q="静夜思",page=1,lang="zh-Hans"); ck("fallback palemoky search 3ch", s==200, (s, b.get("pagination")))
s,b=get(P,"/poems/random",lang="zh-Hant"); ck("fallback palemoky zh-Hant", s==200, (s, (b.get("data") or {}).get("title")))
for c in checks: print("OK " if c[1] else "FAIL", c[0], "|", str(c[2])[:150])
