"""重新切分本站托管的朱雀仿宋（site/fonts/zhuque-fangsong/）。

用法：python3 tools/build-zhuque.py path/to/ZhuqueFangsong-Regular.ttf
  （字体从 https://github.com/TrionesType/zhuque/releases 下载，v0.212 起收录繁体字形）

做法：
- 沿用现有 zhuque-fangsong.css 里每一片的字（原来按常用度分好的片），用新字体重新生成；
- 新字体里多出来的字（主要是繁体）：按 OpenCC 转成简体后，放进与那个简体字「平行」的繁体片里，
  所以只看简体时下载量不变，切到繁体时只多下几片繁体；转不出简体的生僻字按码位每 200 字一片；
- 输出 woff2 + 新的 css（unicode-range 与字体实际收字一致），删掉不再用到的旧分片。
需要：pip install fonttools brotli；node（用 site/vendor 里的 opencc-js 做繁→简）。
"""
import hashlib, json, os, re, subprocess, sys, tempfile
from fontTools.ttLib import TTFont
from fontTools import subset

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "site", "fonts", "zhuque-fangsong")
CSS = os.path.join(DIR, "zhuque-fangsong.css")
OPENCC = os.path.join(HERE, "..", "site", "vendor", "opencc-js-1.4.2", "opencc-full.esm.js")


def parse_css(css):
    out = []
    for m in re.finditer(r'unicode-range:([^;]+);', css):
        cps = set()
        for part in m.group(1).split(","):
            part = part.strip()[2:]
            if "-" in part:
                a, b = part.split("-"); cps.update(range(int(a, 16), int(b, 16) + 1))
            elif part:
                cps.add(int(part, 16))
        out.append(cps)
    return out


def ranges(cps):
    cps = sorted(cps); out = []; i = 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1: j += 1
        out.append(f"U+{cps[i]:X}" if i == j else f"U+{cps[i]:X}-{cps[j]:X}")
        i = j + 1
    return ",".join(out)


def t2s_map(cps):
    # 简单起见：把码位写进临时文件，node 读出后输出映射
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(cps, f); src = f.name
    script = f"""import * as O from {json.dumps("file://" + os.path.abspath(OPENCC))};
import fs from "fs";
const t = O.Converter({{ from: "t", to: "cn" }});
const cps = JSON.parse(fs.readFileSync({json.dumps(src)}, "utf8"));
const out = {{}}; for (const cp of cps) out[cp] = t(String.fromCodePoint(cp));
process.stdout.write(JSON.stringify(out));"""
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as f:
        f.write(script); mjs = f.name
    res = subprocess.run(["node", mjs], capture_output=True, text=True, check=True)
    os.unlink(src); os.unlink(mjs)
    return {int(k): v for k, v in json.loads(res.stdout).items()}


def main(ttf):
    font = TTFont(ttf)
    cmap = set(font.getBestCmap())
    version = font["name"].getDebugName(5) or ""
    groups = [g & cmap for g in parse_css(open(CSS, encoding="utf-8").read())]
    groups = [g for g in groups if g]
    have = set().union(*groups)
    extra = sorted(cmap - have)
    m = t2s_map(extra) if extra else {}
    where = {cp: i for i, g in enumerate(groups) for cp in g}
    trad = {}
    rest = []
    for cp in extra:
        s = m.get(cp, "")
        sc = ord(s) if len(s) == 1 else None
        if sc is not None and sc != cp and sc in where: trad.setdefault(where[sc], set()).add(cp)
        else: rest.append(cp)
    # 平行的繁体片：按原片顺序合并，每片至少 80 字
    new_groups, cur = [], set()
    for i in range(len(groups)):
        if i in trad: cur |= trad[i]
        if len(cur) >= 80: new_groups.append(cur); cur = set()
    if cur: new_groups.append(cur)
    for k in range(0, len(rest), 200): new_groups.append(set(rest[k:k + 200]))
    groups += new_groups
    print(f"{version}: {len(cmap)} chars, {len(groups)} slices ({len(new_groups)} new; {len(extra)} chars added)")

    opts = subset.Options()
    opts.flavor = "woff2"; opts.layout_features = ["*"]; opts.hinting = False
    opts.name_IDs = ["*"]; opts.notdef_outline = True; opts.glyph_names = False
    faces, keep = [], set()
    for g in groups:
        f = TTFont(ttf)
        s = subset.Subsetter(opts); s.populate(unicodes=sorted(g)); s.subset(f)
        f.flavor = "woff2"
        tmp = os.path.join(DIR, ".tmp.woff2"); f.save(tmp)
        data = open(tmp, "rb").read(); os.unlink(tmp)
        name = hashlib.md5(data).hexdigest() + ".woff2"
        open(os.path.join(DIR, name), "wb").write(data); keep.add(name)
        faces.append(f'@font-face{{font-family:"Zhuque Fangsong";src:url("./{name}")format("woff2");font-style:normal;font-display:swap;font-weight:400;unicode-range:{ranges(g)};}}')
    head = (f"/* 朱雀仿宋 Zhuque Fangsong (technical preview) {version.replace('Version ', 'v')} — © JadeFoci / TrionesType 璇玑造字，SIL Open Font License 1.1（见 OFL.txt）。\n"
            f"   按 unicode-range 切成 {len(groups)} 片（tools/build-zhuque.py），浏览器只下载页面用到的字所在的分片；繁体字单独成片，只在显示繁体时才下载。 */\n")
    open(CSS, "w", encoding="utf-8").write(head + "".join(faces) + "\n")
    for fn in os.listdir(DIR):
        if fn.endswith(".woff2") and fn not in keep: os.unlink(os.path.join(DIR, fn))


if __name__ == "__main__":
    main(sys.argv[1])
