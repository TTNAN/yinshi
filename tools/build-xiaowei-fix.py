"""修补站酷小薇（ZCOOL XiaoWei）里画坏的几个字，生成本站托管的小补丁字体 site/fonts/zcool-xiaowei-fix/。

为什么：站酷小薇 v1.000（Google Fonts 提供的就是这一版）里「回」等 8 个字的轮廓方向写错了：
「口」框里面那一圈本该是挖空的，却和外圈同向，浏览器按 nonzero 规则填色，于是整块涂黑，看起来是一个黑方块。
做法：
- 读原字体（https://github.com/google/fonts/raw/main/ofl/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf ，SIL OFL 1.1，无保留字体名）；
- 逐字检查：嵌套在奇数层（应当挖空）的轮廓却与直接包住它的外圈同向、且渲染后墨色过满的字就是坏字；
- 把坏字里这些「该空却同向」的轮廓反过来；其中 回 / 徊 / 蛔 里的小「口」、痼 / 崮 里「古」的口、圃 / 圄 / 圊 框里的部件还漏画了内圈，按同字体「口」「吕」「固」的比例或从单字「甫」「吾」「青」映射补上；去掉这几个字的 hinting 指令（点序变了，指令不再适用）；
- 只保留这几个字，改名为 “Yinshi XiaoWei Fix”（OFL 要求修改版另起名字），输出 woff2 + css（unicode-range 只含这几个字）。
网页字体栈里它排在 “ZCOOL XiaoWei” 前面，只接管这几个字，其余照旧用 Google 的站酷小薇。
用法：python3 tools/build-xiaowei-fix.py path/to/ZCOOLXiaoWei-Regular.ttf
需要：pip install fonttools brotli pillow
"""
import hashlib, io, os, sys, glob
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools import subset
from fontTools.ttLib.tables import ttProgram
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(HERE, "..", "site", "fonts", "zcool-xiaowei-fix")
FAMILY = "Yinshi XiaoWei Fix"


class Flat(BasePen):
    def __init__(self, gs):
        super().__init__(gs); self.cs = []; self.c = None
    def _moveTo(self, p): self.c = [p]
    def _lineTo(self, p): self.c.append(p)
    def _curveToOne(self, a, b, c):
        p0 = self.c[-1]
        for i in range(1, 9):
            t = i / 8; m = 1 - t
            self.c.append((m**3*p0[0]+3*m*m*t*a[0]+3*m*t*t*b[0]+t**3*c[0], m**3*p0[1]+3*m*m*t*a[1]+3*m*t*t*b[1]+t**3*c[1]))
    def _qCurveToOne(self, a, b):
        p0 = self.c[-1]
        for i in range(1, 7):
            t = i / 6; m = 1 - t
            self.c.append((m*m*p0[0]+2*m*t*a[0]+t*t*b[0], m*m*p0[1]+2*m*t*a[1]+t*t*b[1]))
    def _closePath(self):
        if self.c and len(self.c) > 2: self.cs.append(self.c)
        self.c = None
    _endPath = _closePath


def area(c): return sum(c[i][0]*c[i-1][1]-c[i-1][0]*c[i][1] for i in range(len(c))) / 2
def inside(pt, c):
    x, y = pt; n = False
    for i in range(len(c)):
        x1, y1 = c[i-1]; x2, y2 = c[i]
        if (y1 > y) != (y2 > y) and x < (x2-x1)*(y-y1)/(y2-y1+1e-12)+x1: n = not n
    return n
def contains(outer, inner):
    pts = inner[::max(1, len(inner)//8)]
    return abs(area(outer)) > abs(area(inner)) and all(inside(p, outer) for p in pts)
def wrong_holes(cs):
    """嵌套在奇数层、却与直接包住它的那圈同向的轮廓（本该挖空，结果被填实）"""
    out = []
    for i, c in enumerate(cs):
        if abs(area(c)) < 1: continue
        par = [d for j, d in enumerate(cs) if j != i and contains(d, c)]
        if par and len(par) % 2 == 1:
            parent = min(par, key=lambda d: abs(area(d)))
            if (area(parent) > 0) == (area(c) > 0): out.append(i)
    return out


def missing_hole(cs, i, pts):
    """回 / 徊 / 痼 / 蛔 里那个小「口」只画了外圈、漏了内圈（实心方块）：
    这样的轮廓几乎填满自己的外接矩形、里面又没有别的轮廓。按同一字体里「口」「吕」的画法补一个内圈：
    左右取外圈上内角的 x，上下取内角的 y 再各收进 40 / 38 个单位（与「口」「吕」一致）。"""
    c = cs[i]
    xs = [x for x, _ in c]; ys = [y for _, y in c]
    L, B, R, T = min(xs), min(ys), max(xs), max(ys)
    if R - L < 200 or T - B < 200: return None
    if abs(area(c)) / ((R - L) * (T - B)) < 0.85: return None
    if any(j != i and contains(c, d) for j, d in enumerate(cs)): return None
    mid = [(x, y) for x, y in pts if L + (R-L)/3 < x < L + 2*(R-L)/3]
    top = max(y for x, y in mid if y < T - 5); bot = min(y for x, y in mid if y > B + 5)
    row = [x for x, y in pts if y in (top, bot)]
    left, right = min(row), max(row)
    if not (L < left < right < R and B < bot < top < T): return None
    return [(left, bot + 38), (right, bot + 38), (right, top - 40), (left, top - 40)]


# 痼、崮 里的「古」也漏了「口」的内圈（古字那一圈和「口」连成一笔，上面的规则认不出来），
# 按同字体「固」的画法手工补：左右取口内角 x，下取口底内角 y + 38，上取口顶内角 y − 38。
MANUAL_HOLES = {
    0x75FC: [(604, 146), (716, 146), (716, 290), (604, 290)],   # 痼：口内角 x 604–716，底 108，顶 328
    0x5D2E: [(426, 122), (598, 122), (598, 228), (426, 228)],   # 崮：口内角 x 426–598，底 84，顶 266
}


# 圃、圄、圊 框里的部件（甫、吾的口、青的月）也漏了内圈，成了实心块。
# 从同字体里单独的「甫」「吾」「青」取对应部件的内圈，按两边部件外圈的外接矩形等比映射过来。
# 值：(单字, 坏字里那个部件外圈的序号, 单字里对应部件外圈的序号)，序号指 glyf 里的轮廓顺序。
COMPONENT_HOLES = {
    0x5703: ("甫", 2, 0),   # 圃
    0x5704: ("吾", 3, 2),   # 圄
    0x570A: ("青", 2, 1),   # 圊
}


def raw_contours(tt, ch):
    g = tt["glyf"][tt.getBestCmap()[ord(ch)]]
    out = []; start = 0
    for e in g.endPtsOfContours:
        out.append(([tuple(q) for q in g.coordinates[start:e+1]], list(g.flags[start:e+1]))); start = e + 1
    return out


def component_holes(tt, cp, target_pts):
    ch, _, src_idx = COMPONENT_HOLES[cp]
    src = raw_contours(tt, ch)
    outer = src[src_idx][0]
    holes = [(pts, fl) for k, (pts, fl) in enumerate(src) if k != src_idx and contains(outer, pts)]
    bx = lambda pts: (min(x for x, _ in pts), min(y for _, y in pts), max(x for x, _ in pts), max(y for _, y in pts))
    a, b = bx(outer), bx(target_pts)
    sx = (b[2]-b[0]) / (a[2]-a[0]); sy = (b[3]-b[1]) / (a[3]-a[1])
    m = lambda q: (round(b[0] + (q[0]-a[0])*sx), round(b[1] + (q[1]-a[1])*sy))
    return [([m(q) for q in pts], fl) for pts, fl in holes]


def ink_ratio(font_bytes, ch):
    f = ImageFont.truetype(io.BytesIO(font_bytes), 64)
    im = Image.new("L", (80, 80), 0); ImageDraw.Draw(im).text((8, 4), ch, font=f, fill=255)
    bb = im.getbbox()
    if not bb: return 0
    w, h = bb[2]-bb[0], bb[3]-bb[1]
    if w < 25 or h < 25: return 0
    return sum(1 for v in im.crop(bb).getdata() if v > 128) / (w*h)


def main(src):
    tt = TTFont(src)
    raw = open(src, "rb").read()
    cmap = tt.getBestCmap(); gs = tt.getGlyphSet(); glyf = tt["glyf"]
    bad = {}
    for cp, gn in cmap.items():
        if not (0x3400 <= cp <= 0x9fff): continue
        p = Flat(gs); gs[gn].draw(p)
        if len(p.cs) < 2: continue
        wrong = wrong_holes(p.cs)
        if wrong and ink_ratio(raw, chr(cp)) > 0.5:
            bad[cp] = gn
    print("坏字：", "".join(chr(c) for c in sorted(bad)))
    # 把这些该挖空的轮廓反过来
    for cp, gn in bad.items():
        g = glyf[gn]
        coords, ends, flags = list(g.coordinates), list(g.endPtsOfContours), list(g.flags)
        start = 0; nc, nf, ends2 = [], [], []
        conts = []
        for e in ends:
            conts.append((coords[start:e+1], flags[start:e+1])); start = e + 1
        p = Flat(gs); gs[gn].draw(p)
        assert len(p.cs) == len(conts), chr(cp)
        wrong = set(wrong_holes(p.cs))
        for k, (pts, fl) in enumerate(conts):
            if k in wrong:
                pts = [pts[0]] + pts[1:][::-1]; fl = [fl[0]] + fl[1:][::-1]
            nc += pts; nf += fl; ends2.append(len(nc) - 1)
            if cp in COMPONENT_HOLES and COMPONENT_HOLES[cp][1] == k:
                outer_pos = (area(p.cs[k]) > 0) != (k in wrong)
                for hp, hf in component_holes(tt, cp, [tuple(q) for q in pts]):
                    if (area(hp) > 0) == outer_pos: hp = [hp[0]] + hp[1:][::-1]; hf = [hf[0]] + hf[1:][::-1]
                    print(chr(cp), "补内圈（取自「%s」）" % COMPONENT_HOLES[cp][0], len(hp), "点")
                    nc += hp; nf += hf; ends2.append(len(nc) - 1)
            hole = missing_hole(p.cs, k, [tuple(q) for q in pts])
            if hole:
                # 内圈与（修正后的）外圈反向
                outer_pos = (area(p.cs[k]) > 0) != (k in wrong)
                if (area(hole) > 0) == outer_pos: hole = hole[::-1]
                print(chr(cp), "补内圈", hole)
                nc += hole; nf += [1] * 4; ends2.append(len(nc) - 1)
        from fontTools.ttLib.tables._g_l_y_f import GlyphCoordinates
        if cp in MANUAL_HOLES:
            hole = MANUAL_HOLES[cp]
            if area(hole) > 0: hole = hole[::-1]   # 与这几个字修正后的外圈（面积为正）反向
            print(chr(cp), "补内圈（手工）", hole)
            nc += hole; nf += [1] * 4; ends2.append(len(nc) - 1)
        g.coordinates = GlyphCoordinates(nc); g.flags = bytearray(nf); g.endPtsOfContours = ends2; g.numberOfContours = len(ends2)
        g.program = ttProgram.Program(); g.program.fromBytecode(b"")
    buf = io.BytesIO(); tt.save(buf); fixed = buf.getvalue()
    for cp in bad:
        r0, r = ink_ratio(raw, chr(cp)), ink_ratio(fixed, chr(cp))
        print(chr(cp), "墨色占比 %.2f → %.2f" % (r0, r))
        assert r < r0 - 0.15, chr(cp)
        tt2 = TTFont(io.BytesIO(fixed)); p = Flat(tt2.getGlyphSet()); tt2.getGlyphSet()[bad[cp]].draw(p)
        assert not wrong_holes(p.cs), chr(cp)
    # 只留这几个字，改名
    ft = TTFont(io.BytesIO(fixed))
    opt = subset.Options(); opt.hinting = False; opt.layout_features = []; opt.name_IDs = ["*"]; opt.flavor = "woff2"
    s = subset.Subsetter(opt); s.populate(unicodes=sorted(bad)); s.subset(ft)
    for rec in ft["name"].names:
        if rec.nameID in (1, 4, 16): rec.string = FAMILY
        elif rec.nameID == 6: rec.string = FAMILY.replace(" ", "") + "-Regular"
        elif rec.nameID == 3: rec.string = "1.000;" + FAMILY.replace(" ", "")
        elif rec.nameID == 5: rec.string = "Version 1.000; ZCOOL XiaoWei v1.000 with fixed contour direction for " + "".join(chr(c) for c in sorted(bad))
    ft.flavor = "woff2"
    out = io.BytesIO(); ft.save(out); data = out.getvalue()
    os.makedirs(DIR, exist_ok=True)
    for old in glob.glob(os.path.join(DIR, "*.woff2")): os.remove(old)
    name = hashlib.md5(data).hexdigest()[:16] + ".woff2"
    open(os.path.join(DIR, name), "wb").write(data)
    ur = ",".join("U+%04X" % c for c in sorted(bad))
    css = ("/* 站酷小薇补丁 Yinshi XiaoWei Fix —— 只含站酷小薇 v1.000 里轮廓方向画错（显示成黑方块）的 %d 个字：%s。\n"
           "   修好方向后另起名字（tools/build-xiaowei-fix.py 生成）。© The ZCOOL XiaoWei Project Authors，SIL Open Font License 1.1（见 OFL.txt）。 */\n"
           "@font-face{font-family:\"%s\";src:url(\"./%s\")format(\"woff2\");font-style:normal;font-weight:400;font-display:swap;unicode-range:%s}\n"
           % (len(bad), "".join(chr(c) for c in sorted(bad)), FAMILY, name, ur))
    open(os.path.join(DIR, "zcool-xiaowei-fix.css"), "w").write(css)
    print(name, len(data), "bytes;", ur)


if __name__ == "__main__":
    main(sys.argv[1])
