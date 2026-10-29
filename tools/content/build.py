#!/usr/bin/env python3
"""把 tools/content/ 里的诗人简介和赏析生成 site/data/poets.json、site/data/notes.json（原创文字）。
用法：python3 tools/content/build.py"""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
ROOT = os.path.join(HERE, "..", "..")
from poets import P
from notes_daily import N as ND
from notes_more import N as NM
HAN = re.compile(r"[\u3400-\u9fff]")
han = lambda s: "".join(HAN.findall(s))
daily = json.load(open(os.path.join(ROOT, "site/poem/daily-poems.json"), encoding="utf-8"))["poems"]
first = {f"{d['t']}|{d['a']}": han("".join(d["lines"]))[:5] for d in daily}
poets = {k: {"d": d, "y": y, "zi": zi, "bio": bio, "works": works} for k, (d, y, zi, bio, works) in P.items()}
notes = {}
for src in (ND, NM):
    for k, v in src.items():
        v = dict(v)
        v["f"] = han(v.get("f") or first.get(k, ""))[:5]
        if not v["f"]: print("no first line:", k)
        notes[k] = {x: v[x] for x in ("f", "yi", "qing", "bei", "ci") if v.get(x)}
missing = [d["a"] for d in daily if d["a"] not in poets]
assert not missing, missing
nd = [k for k in first if k not in notes]
assert not nd, nd
os.makedirs(os.path.join(ROOT, "site/data"), exist_ok=True)
w = lambda f, o: json.dump(o, open(os.path.join(ROOT, "site/data", f), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
w("poets.json", {"_说明": "诗人简介，吟诗原创撰写（tools/content/poets.py 生成）", "poets": poets})
w("notes.json", {"_说明": "诗意、情感、创作背景与难词注释，吟诗原创撰写（tools/content/ 生成）；键为 诗名|作者，f 为首句前五字", "notes": notes})
from catalog import GRADES, THEMES, FESTIVALS, JIEQI
keys = set(first)
for grp in (GRADES, THEMES):
    for g, ks in grp.items():
        bad = [k for k in ks if k not in keys]; assert not bad, (g, bad)
w("catalog.json", {"_说明": "分类找诗：年级（统编版，只收较确定的篇目）、主题；节日与节气对应的课本诗", "grades": GRADES, "themes": THEMES,
                   "festivals": FESTIVALS, "jieqi": [{"name": n, "m": m, "d": d, "poems": ps} for n, m, d, ps in JIEQI]})
print("poets", len(poets), "notes", len(notes), "catalog", sum(map(len, GRADES.values())))
