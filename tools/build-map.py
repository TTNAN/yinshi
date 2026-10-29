#!/usr/bin/env python3
"""诗人足迹地图的底图：只画山水，不画任何疆界。

由 Natural Earth（公有领域，naturalearthdata.com）的 1:10m 河流中心线与湖泊数据生成
site/data/rivers.json：主要河流、几片大湖，裁到中国东部的经纬度范围，投影后用 Douglas-Peucker 简化成很短的 SVG 路径。
不含海岸线、国界、省界——足迹地图只是一张写意的「山河图」，地点按真实经纬度落点。

用法：python3 tools/build-map.py      （下载的原始数据缓存在 tools/.cache/ne/）
"""
import json, math, os, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache", "ne")
OUT = os.path.join(HERE, "..", "site", "data", "rivers.json")
SRC = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"

# 投影：等距圆柱（经度乘 cos 32°，中纬度不显得扁），范围覆盖凉州到儋州、河套到东海边
LNG0, LNG1, LAT0, LAT1 = 101.0, 123.0, 18.6, 41.4
K = math.cos(math.radians(32))
W = 1000
S = W / ((LNG1 - LNG0) * K)
H = round((LAT1 - LAT0) * S)
def P(lng, lat): return ((lng - LNG0) * K * S, (LAT1 - lat) * S)

def load(name):
    os.makedirs(CACHE, exist_ok=True)
    fn = os.path.join(CACHE, name + ".geojson")
    if not os.path.exists(fn):
        tmp = os.path.join("/tmp/ne", name + ".geojson")
        if os.path.exists(tmp):
            import shutil; shutil.copy(tmp, fn)
        else:
            urllib.request.urlretrieve(SRC + name + ".geojson", fn)
    return json.load(open(fn, encoding="utf-8"))

def lines_of(g):
    if not g: return []
    if g["type"] == "LineString": return [g["coordinates"]]
    if g["type"] == "MultiLineString": return g["coordinates"]
    if g["type"] == "Polygon": return [g["coordinates"][0]]
    if g["type"] == "MultiPolygon": return [p[0] for p in g["coordinates"]]
    return []

def inside(p, box): return box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3]

def clip(line, box=(LNG0, LAT0, LNG1, LAT1)):
    """按范围切成几段（简单做法：在框外的点断开）"""
    out, cur = [], []
    for p in line:
        if inside(p, box): cur.append(p)
        elif cur: out.append(cur); cur = []
    if cur: out.append(cur)
    return [c for c in out if len(c) > 1]

def dp(pts, eps):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy) or 1e-9
    best, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L
        if d > best: best, idx = d, i
    if best <= eps: return [pts[0], pts[-1]]
    return dp(pts[:idx + 1], eps)[:-1] + dp(pts[idx:], eps)

def join(segs):
    """首尾相接的线段连起来，路径更短、墨线不断"""
    segs = [s[:] for s in segs]
    done = True
    while done:
        done = False
        for i in range(len(segs)):
            for j in range(len(segs)):
                if i == j or not segs[i] or not segs[j]: continue
                a, b = segs[i], segs[j]
                if math.dist(a[-1], b[0]) < 1e-6: segs[i] = a + b[1:]; segs[j] = []; done = True
                elif math.dist(a[-1], b[-1]) < 1e-6: segs[i] = a + b[::-1][1:]; segs[j] = []; done = True
        segs = [s for s in segs if s]
    return segs

def path(segs, eps, closed=False):
    d = []
    for s in segs:
        pts = dp([P(*p[:2]) for p in s], eps)
        if len(pts) < 2: continue
        d.append("M" + " ".join(f"{x:.0f},{y:.0f}" for x, y in pts) + ("Z" if closed else ""))
    return "".join(d)

def label_at(segs, lng, lat_hint=None):
    best = None
    for s in segs:
        for p in s:
            score = abs(p[0] - lng) + (abs(p[1] - lat_hint) if lat_hint is not None else 0)
            if best is None or score < best[0]: best = (score, p)
    x, y = P(*best[1][:2])
    return [round(x), round(y)]

# 河流：name（Natural Earth 英文名）、限定范围（同名的别处河流排除）、中文名、标签位置、粗细等级
RIVERS = [
    ("黄河", ["Huang"], None, (113.5, 35.0), 3),
    ("长江", ["Yangtze", "Chang Jiang", "Jinsha"], None, (111.6, 30.2), 3),
    ("汉水", ["Han"], (106, 30, 115, 34.5), (111.2, 32.6), 2),
    ("淮河", ["Huai"], None, (116.6, 32.7), 2),
    ("渭水", ["Wei"], (104, 33.5, 111, 35.6), (107.6, 34.5), 1),
    ("湘江", ["Xiang"], None, (112.7, 26.9), 1),
    ("赣江", ["Gan"], None, (115.0, 27.3), 1),
    ("嘉陵江", ["Jialing"], None, (106.3, 31.4), 1),
    ("岷江", ["Min"], (102, 28, 105, 33), (103.8, 30.9), 1),
    ("西江", ["Xi"], None, (110.8, 23.5), 2),
    ("北江", ["Bei"], (112, 22.5, 115, 26), None, 1),
    ("东江", ["Dong"], (113, 22.5, 116, 25.5), None, 1),
    ("钱塘江", ["Fuchun"], None, (119.5, 29.8), 1),
]
LAKES = [("洞庭湖", "Dongting Hu"), ("鄱阳湖", "Poyang Hu"), ("太湖", "Tai Hu"), ("洪泽湖", "Hongze Hu"), ("巢湖", "Chao Hu")]
# 名山：画成几笔小山，只作点缀（不是地点，不可点）
HILLS = [("泰山", 117.1, 36.26), ("华山", 110.08, 34.48), ("嵩山", 113.03, 34.48), ("秦岭", 108.2, 33.8), ("黄山", 118.17, 30.13),
         ("峨眉", 103.33, 29.52), ("南岭", 113.3, 25.4), ("太行", 113.6, 37.6), ("巫山", 109.9, 31.1), ("武夷", 117.7, 27.7)]

def main():
    rv = load("ne_10m_rivers_lake_centerlines")
    lk = load("ne_10m_lakes")
    out = {"source": "Natural Earth 1:10m（公有领域，naturalearthdata.com），经简化；不含任何疆界、海岸线",
           "proj": {"lng0": LNG0, "lat1": LAT1, "k": round(K, 6), "s": round(S, 4)}, "w": W, "h": H,
           "rivers": [], "lakes": [], "hills": []}
    for zh, names, box, lab, rank in RIVERS:
        segs = []
        for f in rv["features"]:
            if f["properties"].get("name") not in names: continue
            for line in lines_of(f["geometry"]):
                if box and not any(inside(p, box) for p in line): continue
                segs += clip(line, box) if box else clip(line)
        segs = join(segs)
        if not segs: print("缺：", zh); continue
        r = {"n": zh, "r": rank, "d": path(segs, 0.9 if rank >= 2 else 1.3)}
        if lab: r["lab"] = label_at(segs, lab[0], lab[1])
        out["rivers"].append(r)
    for zh, en in LAKES:
        segs = [l for f in lk["features"] if f["properties"].get("name") == en for l in lines_of(f["geometry"])]
        if not segs: print("缺：", zh); continue
        segs.sort(key=len, reverse=True)
        d = path(segs[:1], 1.2, closed=True)
        xs = [P(*p[:2]) for p in segs[0]]
        cx, cy = sum(x for x, _ in xs) / len(xs), sum(y for _, y in xs) / len(xs)
        out["lakes"].append({"n": zh, "d": d, "c": [round(cx), round(cy)]})
    for zh, lng, lat in HILLS:
        x, y = P(lng, lat)
        out["hills"].append({"n": zh, "x": round(x), "y": round(y)})
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(OUT, os.path.getsize(OUT), "bytes;", "viewBox", W, H)

if __name__ == "__main__":
    main()
