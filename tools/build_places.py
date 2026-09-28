#!/usr/bin/env python3
"""Build places.json from the spec's section 6 tables.

Rows with lat/lng are used as given (owner's Google Maps list).
Rows without are geocoded with OpenStreetMap Nominatim (1 request/second,
identifying User-Agent, results cached in tools/geocode_cache.json).
Hours are filled only where a linked source states them (see HOURS_SOURCES).

Usage: python3 tools/build_places.py   (writes places.json + GEOCODE_REPORT.md)
"""
import json, math, os, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", "geocode_cache.json")
UA = "TaiwanTripMap/1.0 (personal non-commercial trip map; one-off batch geocode)"

MICHELIN_2026_FULL = "https://guide.michelin.com/tw/en/article/michelin-guide-ceremony/taiwan-full-list"
MICHELIN_2026_BIB = "https://guide.michelin.com/tw/en/article/michelin-guide-ceremony/taiwan-2026-bib-gourmand-list"
KATALOG = "https://theordinarykatalog.com/taichung-food-guide/"
KEMBEL_TC = "https://www.nickkembel.com/things-to-do-in-taichung/"

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def hours(**kw):
    """hours(mon_fri=[...], sat=[], sun=...) -> full 7-day dict. Keys may be day
    names or ranges like mon_sat / all."""
    out = {}
    for key, val in kw.items():
        if key == "all":
            ds = DAYS
        elif "_" in key:
            a, b = key.split("_")
            ds = DAYS[DAYS.index(a): DAYS.index(b) + 1]
        else:
            ds = [key]
        for d in ds:
            out[d] = val
    missing = [d for d in DAYS if d not in out]
    assert not missing, missing
    return {d: out[d] for d in DAYS}


def gmaps_text(r):
    """Search text for the Google Maps link. The spec's "name + city" often opens the
    wrong place for English Michelin names, so use "name, street address" when the
    source gives an address (verified in the browser, see README)."""
    if r["id"] in ZH:
        zh_name, zh_addr = ZH[r["id"]]
        return f"{zh_name} {zh_addr}"
    if r.get("address"):
        return f"{r['name']}, {r['address']}"
    return f"{r['name']} {r['city']}"


def gsearch(q):
    return "https://www.google.com/maps/search/?api=1&query=" + urllib.parse.quote(q)


def cidlink(cid):
    return f"https://maps.google.com/?cid={cid}"


# ---------------------------------------------------------------- 6.1-6.3
# (id, name, city, district, category, tags, lat, lng, cid, why, flag)
LISTED = [
    # 6.1 Home base
    ("tc-home-meishuguandao", "國泰美術觀道 (Mei Shu Guan Dao), Wuquan 6th St", "Taichung", "West", "home-base", [], 24.135834, 120.664215, "12323566414725696821", "Where Calvin stays in Taichung. Default map center and itinerary start.", None),
    ("tc-home-gong-tsing", "Gong Tsing (No. 485, Sec. 3, Fuxing Rd)", "Taichung", "South", "home-base", [], 24.134011, 120.681643, "15876232777521764072", "", None),
    # 6.2 Taichung
    ("tc-torien-yakitori", "Torien Yakitori", "Taichung", "West", "food", ["michelin"], 24.155431, 120.658322, "13315825835930134457", "Yakitori; Michelin Selected 2026", None),
    ("tc-lao-wang-hakka", "老王客家莊（五權總店）", "Taichung", "West", "food", [], 24.136473, 120.661392, "8049332745289313955", "Calvin: authentic Hakka food, 30-year-old hole in the wall, might need reservations", None),
    ("tc-chun-shui-tang-original", "The Original Store of Chun Shui Tang", "Taichung", "West", "food", [], 24.137551, 120.675581, "5403901197616972105", "Original bubble tea shop; tea house", None),
    ("tc-minimal", "MINIMAL", "Taichung", "West", "food", [], 24.151699, 120.662340, "1904530289138725321", "Ice cream", None),
    ("tc-richu-dadi", "日出‧大地", "Taichung", "West", "food", [], 24.138582, 120.663200, "839829008045225856", "Bakery: cheesecake, pineapple cakes, gifts", None),
    ("tc-phase-coffee", "Phase Coffee Roasters", "Taichung", "Central", "food", [], 24.139780, 120.680842, "5525236978207553119", "Cafe", None),
    ("tc-second-market", "Taichung Second Market", "Taichung", "Central", "food", [], 24.142418, 120.678757, "13623224561668156756", "Traditional market", None),
    ("tc-park-jade-market", "Taichung Park Jade Market", "Taichung", "Central", "shopping", [], 24.142720, 120.683208, "13577680991677488036", "Market", None),
    ("tc-washida-home", "Washida Home Store", "Taichung", "West", "shopping", [], 24.148662, 120.662859, "5021701981640386650", "Home goods", None),
    ("tc-less-minquan", "LESS Taichung 台中民權店", "Taichung", "West", "shopping", [], 24.147409, 120.668391, "884189645548701931", "Fashion accessories", None),
    ("tc-undefeated", "UNDEFEATED 台中", "Taichung", "West", "shopping", ["streetwear"], 24.151785, 120.662608, "14703338986301272158", "Clothing", None),
    ("tc-rifare", "Rifare_co", "Taichung", "Xitun", "shopping", ["streetwear"], 24.175929, 120.646411, "14579912171220177758", "Shoes", None),
    ("tc-supersunday", "SuperSunday", "Taichung", "Taiping", "shopping", ["streetwear"], 24.142332, 120.718240, "15938411308587988363", "Fashion accessories", None),
    ("tc-saltedfish-fengjia", "saltedfish鹹魚-逢甲店", "Taichung", "Xitun", "shopping", ["vintage"], 24.178242, 120.645686, "2132735251155926499", "Used clothing", None),
    ("tc-rolling-on-sunrise", "Rolling On Sunrise", "Taichung", "West", "shopping", ["vintage"], 24.145764, 120.662751, "8529854684821246446", "Vintage select shop", None),
    ("tc-nmr-chinmei", "NMR勤美店", "Taichung", "West", "shopping", ["streetwear"], 24.151388, 120.662281, "15730581410230349379", "", None),
    ("tc-etw-chinmei", "ETW 台中勤美旗艦店", "Taichung", "West", "shopping", ["streetwear"], 24.151764, 120.662378, "513280700361307672", "", None),
    ("tc-beams-lalaport", "BEAMS LaLaport 台中", "Taichung", "East", "shopping", ["streetwear"], 24.135762, 120.692551, "25068881671103275", "", None),
    ("tc-beams-skm-zhonggang", "BEAMS 新光三越中港", "Taichung", "Xitun", "shopping", ["streetwear"], 24.165193, 120.643691, "8919104833278566934", "", "Google lists the Zhonggang Shin Kong Mitsukoshi as no longer existing — check before going"),
    ("tc-carhartt-top-city", "Carhartt WIP 台中大遠百", "Taichung", "Xitun", "shopping", ["streetwear"], 24.164466, 120.644596, "477071713791994723", "", None),
    ("tc-carhartt-flagship", "Carhartt WIP 台中旗艦店", "Taichung", "West", "shopping", ["streetwear"], 24.151317, 120.662185, "18286999663316642428", "", None),
    ("tc-stussy", "Stussy Taichung", "Taichung", "West", "shopping", ["streetwear"], 24.151635, 120.662016, "14771289615047559324", "", None),
    ("tc-hysteria", "Hysteria Store", "Taichung", "North", "shopping", ["streetwear"], 24.150898, 120.684271, "8151418916522739287", "", None),
    ("tc-dycteam-lalaport", "DYCTEAM select lab - LaLaport 臺中", "Taichung", "East", "shopping", ["streetwear"], 24.135791, 120.692454, "11274551175832746342", "", None),
    ("tc-dycteam-skm-zhonggang", "DYCTEAM select shop - 台中新光中港", "Taichung", "Xitun", "shopping", ["streetwear"], 24.165257, 120.643708, "6866903784859144006", "", "May be affected by the Shin Kong Mitsukoshi closure — check before going"),
    ("tc-lomopie", "Lomopie", "Taichung", "West", "shopping", [], 24.148496, 120.659113, "10969977275033502822", "", None),
    ("tc-ramon-central", "RAMON CENTRAL", "Taichung", "West", "shopping", ["streetwear"], 24.151652, 120.662544, "3677579142785108649", "", None),
    ("tc-juice", "JUICE Taichung", "Taichung", "West", "shopping", ["streetwear"], 24.152274, 120.662712, "5496595129740953347", "Calvin: sneaker store", None),
    ("tc-invincible-central", "Invincible Central", "Taichung", "West", "shopping", ["streetwear"], 24.151636, 120.662336, "9084163362785129663", "Calvin: sneaker/streetwear", None),
    ("tc-jordan301", "JORDAN301TAICHUNG", "Taichung", "Xitun", "shopping", ["streetwear"], 24.164767, 120.643475, "15917411899557999460", "Calvin: sneaker store", None),
    ("tc-phantaci", "PHANTACi", "Taichung", "North", "shopping", ["streetwear"], 24.152836, 120.686204, "15709390559622978836", "Calvin: sneaker store", None),
    ("tc-since1996", "Since1996 Clothing (預約制)", "Taichung", "West", "shopping", ["vintage"], 24.163664, 120.652007, "2534896873762647466", "Appointment only", None),
    ("tc-beams-outlet-port", "BEAMS OUTLET 台中港", "Taichung", "Wuqi", "shopping", ["streetwear"], 24.258002, 120.519130, "1835929586283749454", "Calvin: Beams outlet mall; far from center", None),
    ("tc-nike-factory-port", "Nike Factory Store 台中港三井", "Taichung", "Wuqi", "shopping", ["streetwear"], 24.258602, 120.516971, "7345922614818988586", "Calvin: Nike factory outlet; far from center", None),
    ("tc-kodah", "柯達行 Kodah photography equipment", "Taichung", "Central", "shopping", ["film-gear"], 24.141858, 120.680294, "15085411182885003258", "Calvin: film camera store", None),
    ("tc-pro-camera", "普羅相機", "Taichung", "North", "shopping", ["film-gear"], 24.147499, 120.683320, "3969755304183615627", "Calvin: camera store", None),
    ("tc-fujifilm-imaging", "Fujifilm Digital Imaging", "Taichung", "South", "film-lab", [], 24.108282, 120.657600, "9283611673369156681", "Photo lab", None),
    ("tc-zhongshan-photo", "中山攝影社", "Taichung", "South", "film-lab", [], 24.132185, 120.677878, "770838214277919359", "Photo lab", None),
    ("tc-shiguang-film-cafe", "時光 (film developing + dessert cafe)", "Taichung", "Central", "film-lab", [], 24.140148, 120.681618, "8579690814773493259", "Film lab with pudding, scones, pound cake", None),
    ("tc-jinfeilin-lab", "金霏林沖放會社", "Taichung", "West", "film-lab", [], 24.140717, 120.646498, "10405050418255694218", "Film lab", None),
    ("tc-xuli-lab", "旭麗數位沖印店", "Taichung", "Xitun", "film-lab", [], 24.180793, 120.637748, "10191466143537548160", "Photo lab", None),
    # 6.3 Taipei (no district column in the spec)
    ("tp-beams-nanxi", "BEAMS 誠品生活南西", "Taipei", None, "shopping", ["streetwear"], 25.052131, 121.520677, "1212946090264151146", "", None),
    ("tp-beams-taipei", "BEAMS Taipei Store", "Taipei", None, "shopping", ["streetwear"], 25.060384, 121.557104, "10275743034727845299", "", None),
    ("tp-juice", "JUICE Taipei", "Taipei", None, "shopping", ["streetwear"], 25.043341, 121.550881, "3506743030826430047", "", None),
    ("tp-mitty", "Mitty", "Taipei", None, "shopping", [], 25.055069, 121.519669, "15754689255237403442", "", None),
    ("tp-invincible", "INVINCIBLE TPE", "Taipei", None, "shopping", ["streetwear"], 25.044034, 121.550912, "15795879522314512064", "", None),
    ("tp-stussy", "Stüssy Taipei", "Taipei", None, "shopping", ["streetwear"], 25.044006, 121.552548, "564154148224525071", "", None),
    ("tp-stussy-xinyi", "STUSSY XINYI", "Taipei", None, "shopping", ["streetwear"], 25.036718, 121.568131, "7844211159998554255", "", None),
    ("tp-waiting-room", "Waiting Room", "Taipei", None, "shopping", [], 25.049352, 121.520222, "5088263451892638532", "", None),
    ("tp-par-store", "PAR STORE", "Taipei", None, "shopping", ["streetwear"], 25.053460, 121.519357, "2100819134762119361", "", None),
    ("tp-snappp", "SNAPPP寫真私館 AKA赤店", "Taipei", None, "shopping", ["film-gear"], 25.056471, 121.519686, "16028830562431587257", "Calvin: film camera store chain", None),
    ("tp-beorg-camera", "Beorg camera 貝爾格相機店", "Taipei", None, "film-lab", [], 25.025183, 121.512190, "9677951322303436498", "Calvin: film, cameras and lab; highly rated", None),
    ("tp-linwu-lab", "林屋沖洗", "Taipei", None, "film-lab", [], 25.046141, 121.511854, "14841318173817757605", "Calvin: film and film cameras", None),
    ("tp-gongguan-flea", "公館創意跳蚤市集", "Taipei", None, "shopping", [], 25.012797, 121.533778, "5125481454648952658", "Calvin: flea market", None),
    ("tp-housing-101-view", "Housing", "Taipei", None, "attraction", [], 25.025524, 121.569699, "538884408838605488", "Calvin: alley view of Taipei 101", None),
]

# ---------------------------------------------------------------- 6.4-6.6
# Each: dict with id, name, city, district, category, tags, why, sources,
# queries (Nominatim, tried in order), optional address, hours, michelin_geo
# (the Michelin page's own lat/lng, used only as a cross-check), flag, dates.
R = []

# Chinese name + address from each restaurant's Michelin zh_TW page (same URL slug).
# Used for the Google Maps link (English names often open the wrong place) and shown on the card.
ZH = {
 "tc-don-moo": (
  "東沐。食在",
  "臺中市北區英才路317號"
 ),
 "tc-fu-din-wang-central": (
  "富鼎旺 (中區)",
  "臺中市中區臺灣大道一段560號"
 ),
 "tc-ke-kou-beef-noodles": (
  "可口牛肉麵",
  "臺中市西屯區大墩路911號"
 ),
 "tc-taichung-meatball": (
  "台中肉員",
  "臺中市南區復興路三段529號"
 ),
 "tc-night-school-pork-rice": (
  "夜間部爌肉飯",
  "臺中市西區精誠路109號"
 ),
 "tc-lao-shih-kuan-noodles": (
  "老士官擀麵",
  "臺中市清水區鎮南街81之12號"
 ),
 "tc-shanghai-food-nantun": (
  "滬舍餘味 (南屯)",
  "臺中市南屯區公益路二段537號"
 ),
 "tc-feng-chi-goose": (
  "鳳記鵝肉老店",
  "臺中市沙鹿區屏西路170號"
 ),
 "tc-niou-jia-juang": (
  "牛稼莊",
  "臺中市東勢區新豐街19號"
 ),
 "tc-jl-studio": (
  "JL STUDIO",
  "臺中市西區存中街59號"
 ),
 "tp-yu-yu-1969": (
  "有有1969",
  "臺北市中山區遼寧街48號"
 ),
 "tp-open-smile": (
  "開囍",
  "臺北市信義區莊敬路441號"
 ),
 "tp-ching-jiao": (
  "青嬌",
  "臺北市中正區濟南路二段9號"
 ),
 "tp-wangs-broth": (
  "小王煮瓜",
  "臺北市萬華區華西街17之4號153號攤 (華西街夜市)"
 ),
 "tp-hsiung-chi-scallion-pancake": (
  "雄記蔥抓餅",
  "臺北市中正區羅斯福路四段108巷2號 (公館夜市)"
 ),
 "tp-yuan-huan-pien-oyster": (
  "圓環邊蚵仔煎",
  "臺北市大同區寧夏路46號 (寧夏夜市)"
 )
}


def add(**kw):
    kw.setdefault("tags", [])
    kw.setdefault("district", None)
    kw.setdefault("address", None)
    kw.setdefault("hours", None)
    kw.setdefault("hours_source", None)
    kw.setdefault("michelin_geo", None)
    kw.setdefault("flag", None)
    kw.setdefault("startDate", None)
    kw.setdefault("endDate", None)
    kw.setdefault("gmaps_query", None)
    R.append(kw)


def mich(label, url):
    return {"label": label, "url": url}


# 6.4 food
add(id="tc-don-moo", name="Don Moo", city="Taichung", district="North", category="food", tags=["michelin"],
    why="Bib Gourmand, new 2026; duck rice and dry duck noodles",
    sources=[mich("Michelin Bib Gourmand 2026 list", MICHELIN_2026_BIB), mich("Michelin page", "https://guide.michelin.com/tw/en/taichung-region/taichung/restaurant/don-moo")],
    address="317 Yingcai Road, North District, Taichung",
    queries=["英才路317號, 北區, 臺中市", "317 Yingcai Road, North District, Taichung"],
    michelin_geo=(24.1555746, 120.6699952),
    hours=hours(mon=[], tue_fri=[["11:30", "14:30"]], sat=[], sun=[]), hours_source="Michelin page")
add(id="tc-fu-din-wang-central", name="Fu Din Wang (Central)", city="Taichung", district="Central", category="food", tags=["michelin"],
    why="Bib Gourmand; braised pork rice and pork knuckle",
    sources=[mich("Michelin page", "https://guide.michelin.com/us/en/taichung-region/taichung/restaurant/fu-din-wang-central")],
    address="560, Section 1, Taiwan Boulevard, Central District, Taichung",
    queries=["臺灣大道一段560號, 中區, 臺中市", "560 Section 1 Taiwan Boulevard, Taichung", "富鼎旺 中區 臺中市", "富鼎旺"],
    michelin_geo=(24.1451927, 120.6765412),
    hours=hours(mon_sat=[["11:00", "14:30"]], sun=[]), hours_source="Michelin page")
add(id="tc-ke-kou-beef-noodles", name="Ke Kou Beef Noodles", city="Taichung", district="Xitun", category="food", tags=["michelin"],
    why="Bib Gourmand; beef noodle soup (Xitun)",
    sources=[mich("Michelin page", "https://guide.michelin.com/us/en/taichung-region/taichung/restaurant/ke-kou-beef-noodles")],
    address="911 Dadun Road, Xitun District, Taichung",
    queries=["大墩路911號, 西屯區, 臺中市", "911 Dadun Road, Xitun District, Taichung", "可口牛肉麵, 臺中市"],
    michelin_geo=(24.1569617, 120.6504773),
    hours=hours(mon_fri=[["11:00", "14:00"], ["16:30", "20:00"]], sat=[], sun=[]), hours_source="Michelin page")
add(id="tc-taichung-meatball", name="Taichung Meatball", city="Taichung", district="South", category="food", tags=["michelin"],
    why="Bib Gourmand; small eats",
    sources=[mich("Michelin page", "https://guide.michelin.com/us/en/taichung-region/taichung/restaurant/taichung-meatball")],
    address="529, Section 3, Fuxing Road, South District, Taichung",
    queries=["復興路三段529號, 南區, 臺中市", "529 Section 3 Fuxing Road, Taichung", "台中肉員"],
    michelin_geo=(24.1343963, 120.6827409),
    hours=hours(all=[["10:30", "19:00"]]), hours_source="Michelin page")
add(id="tc-night-school-pork-rice", name="Night School Braised Pork Rice", city="Taichung", district="West", category="food", tags=["michelin"],
    why="Bib Gourmand; small eats",
    sources=[mich("Michelin page", "https://guide.michelin.com/us/en/taichung-region/taichung/restaurant/night-school-braised-pork-rice")],
    address="109 Jingcheng Road, West District, Taichung",
    queries=["精誠路109號, 西區, 臺中市", "109 Jingcheng Road, West District, Taichung"],
    michelin_geo=(24.1504785, 120.6552633),
    hours=hours(all=[["17:00", "02:00"]]), hours_source="Michelin page")
add(id="tc-lao-shih-kuan-noodles", name="Lao Shih Kuan Noodles", city="Taichung", district="Qingshui", category="food", tags=["michelin"],
    why="Bib Gourmand; noodles",
    sources=[mich("Michelin page", "https://guide.michelin.com/us/en/taichung-region/taichung/restaurant/lao-shih-kuan-noodles")],
    address="81-12 Zhennan Street, Qingshui District, Taichung",
    queries=["鎮南街81-12號, 清水區, 臺中市", "81-12 Zhennan Street, Qingshui District, Taichung", "鎮南街, 清水區, 臺中市", "老士官擀麵, 臺中市"],
    michelin_geo=(24.2683251, 120.5720504),
    hours=hours(mon=[], tue_sun=[["08:00", "13:30"]]), hours_source="Michelin page")
add(id="tc-shanghai-food-nantun", name="Shanghai Food (Nantun)", city="Taichung", district="Nantun", category="food", tags=["michelin"],
    why="Bib Gourmand; dim sum",
    sources=[mich("Michelin page", "https://guide.michelin.com/us/en/taichung-region/taichung/restaurant/shanghai-food")],
    address="537, Section 2, Gongyi Road, Nantun District, Taichung",
    queries=["公益路二段537號, 南屯區, 臺中市", "537 Section 2 Gongyi Road, Nantun District, Taichung", "滬舍餘味, 臺中市"],
    michelin_geo=(24.142718, 120.6373369),
    report_note="Google Maps lists 滬舍餘味 at No. 537, Sec. 2, Gongyi Rd at about 24.1512, 120.6357 — about 1 km from the Michelin page's pin, so the Michelin pin itself looks off here. Open in Google Maps goes to the right place.",
    hours=hours(all=[["11:00", "20:00"]]), hours_source="Michelin page")
add(id="tc-feng-chi-goose", name="Feng Chi Goose", city="Taichung", district="Shalu", category="food", tags=["michelin"],
    why="Bib Gourmand; Taiwanese",
    sources=[mich("Michelin page", "https://guide.michelin.com/us/en/taichung-region/taichung/restaurant/feng-chi-goose")],
    address="170 Pingxi Road, Shalu District, Taichung",
    queries=["屏西路170號, 沙鹿區, 臺中市", "170 Pingxi Road, Shalu District, Taichung"],
    michelin_geo=(24.2097324, 120.5691427),
    hours=hours(mon_tue=[["09:00", "20:00"]], wed=[], thu_sun=[["09:00", "20:00"]]), hours_source="Michelin page")
add(id="tc-niou-jia-juang", name="Niou Jia Juang", city="Taichung", district="Dongshi", category="food", tags=["michelin"],
    why="Bib Gourmand; Hakka",
    sources=[mich("Michelin page", "https://guide.michelin.com/us/en/taichung-region/taichung/restaurant/niou-jia-juang")],
    address="19 Xinfeng Street, Dongshi District, Taichung",
    queries=["新豐街19號, 東勢區, 臺中市", "19 Xinfeng Street, Dongshi District, Taichung"],
    michelin_geo=(24.2628521, 120.824839),
    hours=hours(mon=[["11:00", "15:00"]], tue=[], wed_sun=[["11:00", "15:00"]]), hours_source="Michelin page")
add(id="tc-jl-studio", name="JL Studio", city="Taichung", district="West", category="food", tags=["michelin"],
    why="Three Michelin stars (2026); splurge, book ahead",
    sources=[mich("Michelin Taiwan 2026 full list", MICHELIN_2026_FULL), mich("Michelin page", "https://guide.michelin.com/tw/en/taichung-region/taichung/restaurant/jl-studio")],
    address="59, Cunzhong Street, West District, Taichung",
    queries=["存中街59號, 西區, 臺中市", "59 Cunzhong Street, West District, Taichung", "JL Studio, 臺中市"], gmaps_query="JL Studio Taichung",  # resolves directly; address/zh queries gave a list
    michelin_geo=(24.1411392, 120.6589807),
    hours=hours(mon=[], tue=[], wed_fri=[["18:00", "22:00"]], sat_sun=[["12:00", "14:30"]]), hours_source="Michelin page")
add(id="tc-fengchia-night-market", name="Fengchia Night Market", city="Taichung", district="Xitun", category="food",
    why="Huge night market (Wenhua Rd, Xitun); stalls: 官芝霖大腸包小腸, 逢甲丹丹香葱油餅",
    sources=[mich("The Ordinary Katalog", KATALOG)],
    queries=["逢甲夜市, 臺中市", "Fengjia Night Market, Taichung", "文華路, 西屯區, 臺中市"])
add(id="tc-he-jia-egg-pancake", name="賀家蛋餅 (Fengchia)", city="Taichung", district="Xitun", category="food",
    why="Crispy pork chop egg pancake; breakfast; closed Sundays",
    sources=[mich("The Ordinary Katalog", KATALOG)],
    queries=["賀家蛋餅, 臺中市", "賀家蛋餅"],
    hours=hours(mon_sat=[["07:00", "12:00"]], sun=[]), hours_source="The Ordinary Katalog")
add(id="tc-taiwan-king-noodles", name="大王麻辣乾麵 Taiwan King (永福總店)", city="Taichung", district="Xitun", category="food",
    why="Spicy dry noodles, 7 heat levels",
    sources=[mich("The Ordinary Katalog", KATALOG)],
    queries=["大王麻辣乾麵, 臺中市", "大王麻辣乾麵 永福", "Taiwan King spicy noodles Taichung"], strict_district=True,
    hours=hours(all=[["11:30", "21:00"]]), hours_source="The Ordinary Katalog")
add(id="tc-miyahara", name="Miyahara 宮原眼科", city="Taichung", district="Central", category="food",
    why="Ice cream in a restored Japanese-era eye clinic, near Taichung Station; go early",
    sources=[mich("Nick Kembel: Taichung", KEMBEL_TC)],
    queries=["宮原眼科, 臺中市", "Miyahara, Taichung"])
add(id="tc-haritts", name="Haritts Donuts & Coffee (Taichung)", city="Taichung", district="West", category="food",
    why="Japanese-style donuts near the Calligraphy Greenway",
    sources=[mich("The Ordinary Katalog", KATALOG)],
    queries=["Haritts, 臺中市", "Haritts Donuts Taichung", "Haritts"],
    hours=hours(all=[["11:00", "18:30"]]), hours_source="The Ordinary Katalog")
add(id="tc-yizhong-night-market", name="Yizhong Street Night Market", city="Taichung", district="North", category="food",
    why="Night market just north of Taichung Park",
    sources=[mich("Nick Kembel: Taichung", KEMBEL_TC)],
    queries=["一中街, 北區, 臺中市", "一中商圈, 臺中市", "Yizhong Street, Taichung"], allow_road=True)
add(id="tp-yu-yu-1969", name="Yu Yu 1969", city="Taipei", district="Zhongshan", category="food", tags=["michelin"],
    why="Bib Gourmand, new 2026; Taiwanese stir-fries",
    sources=[mich("Michelin Bib Gourmand 2026 list", MICHELIN_2026_BIB), mich("Michelin page", "https://guide.michelin.com/tw/en/taipei-region/taipei/restaurant/yu-yu-1969")],
    address="48 Liaoning Street, Zhongshan District, Taipei",
    queries=["遼寧街48號, 中山區, 臺北市", "48 Liaoning Street, Zhongshan District, Taipei"],
    michelin_geo=(25.049029, 121.542052),
    hours=hours(mon_sat=[["11:00", "14:00"]], sun=[]), hours_source="Michelin page")
add(id="tp-open-smile", name="Open Smile", city="Taipei", district="Xinyi", category="food", tags=["michelin"],
    why="Bib Gourmand, new 2026; braised pork",
    sources=[mich("Michelin Bib Gourmand 2026 list", MICHELIN_2026_BIB), mich("Michelin page", "https://guide.michelin.com/tw/en/taipei-region/taipei/restaurant/open-smile")],
    address="441 Zhuangjing Road, Xinyi District, Taipei",
    queries=["莊敬路441號, 信義區, 臺北市", "441 Zhuangjing Road, Xinyi District, Taipei"],
    michelin_geo=(25.0271433, 121.5671518))
add(id="tp-ching-jiao", name="Ching Jiao", city="Taipei", district="Zhongzheng", category="food", tags=["michelin"],
    why="Bib Gourmand, new 2026; chicken soup",
    sources=[mich("Michelin Bib Gourmand 2026 list", MICHELIN_2026_BIB), mich("Michelin page", "https://guide.michelin.com/tw/en/taipei-region/taipei/restaurant/ching-jiao")],
    address="9, Section 2, Jinan Road, Zhongzheng District, Taipei",
    queries=["濟南路二段9號, 中正區, 臺北市", "9 Section 2 Jinan Road, Zhongzheng District, Taipei"],
    michelin_geo=(25.041449, 121.527123))
add(id="tp-wangs-broth", name="Wang's Broth 小王煮瓜", city="Taipei", district="Wanhua", category="food", tags=["michelin"],
    why="Bib Gourmand 2026; braised pork rice; Huaxi Street Night Market, Wanhua",
    sources=[mich("Michelin page", "https://guide.michelin.com/us/en/taipei-region/taipei/restaurant/hsiao-wang-steamed-minced-pork-with-pickles-in-broth")],
    address="Huaxi Street Night Market, Stall 153, 17-4 Huaxi Street, Wanhua District, Taipei",
    queries=["小王煮瓜, 臺北市", "華西街17-4號, 萬華區, 臺北市", "華西街觀光夜市, 臺北市"],
    michelin_geo=(25.03921, 121.49846),
    hours=hours(mon=[["09:30", "20:00"]], tue=[], wed_sun=[["09:30", "20:00"]]), hours_source="Michelin page")
add(id="tp-hsiung-chi-scallion-pancake", name="Hsiung Chi Scallion Pancake 雄記蔥抓餅", city="Taipei", district="Zhongzheng", category="food", tags=["michelin"],
    why="Bib Gourmand; 2, Lane 108, Sec. 4, Roosevelt Rd (Gongguan Night Market)",
    sources=[mich("Michelin page", "https://guide.michelin.com/jp/ja/taipei-region/taipei/restaurant/hsiung-chi-scallion-pancake")],
    address="2, Lane 108, Section 4, Roosevelt Road, Zhongzheng District, Taipei",
    queries=["雄記蔥抓餅, 臺北市", "羅斯福路四段108巷2號, 臺北市", "羅斯福路四段108巷, 臺北市"],
    michelin_geo=(25.0129692, 121.5357748))
add(id="tp-yuan-huan-pien-oyster", name="Yuan Huan Pien Oyster Egg Omelette", city="Taipei", district="Datong", category="food", tags=["michelin"],
    why="Michelin Selected 2026",
    sources=[mich("Michelin Taiwan 2026 full list", MICHELIN_2026_FULL), mich("Michelin page", "https://guide.michelin.com/tw/en/taipei-region/taipei/restaurant/yuan-huan-pien-oyster-egg-omelette")],
    address="Ningxia Night Market, 46 Ningxia Road, Datong District, Taipei",
    queries=["圓環邊蚵仔煎, 臺北市", "寧夏路46號, 大同區, 臺北市", "寧夏夜市, 臺北市"],
    michelin_geo=(25.0563308, 121.5152488),
    hours=hours(mon_wed=[["12:00", "14:30"]], thu=[], fri_sun=[["12:00", "14:30"]]), hours_source="Michelin page")

# 6.5 kid-friendly attractions
K = ["kid-friendly"]
add(id="tc-natural-science-museum", name="National Museum of Natural Science", city="Taichung", district="North", category="attraction", tags=K,
    why="Moving life-size dinosaurs, IMAX", flag="A review reported the dinosaur hall temporarily closed — check",
    sources=[mich("Nick Kembel: Taichung", KEMBEL_TC)], address="No. 1, Guanqian Rd, North District, Taichung",
    queries=["國立自然科學博物館, 臺中市", "館前路1號, 北區, 臺中市"])
add(id="tc-921-earthquake-museum", name="921 Earthquake Museum", city="Taichung", district="Wufeng", category="attraction", tags=K,
    why="Preserved school on the fault line, quake simulator", flag="Simulator reported closed on one visit",
    sources=[mich("Nick Kembel: Taichung", KEMBEL_TC)], address="No. 192, Xinsheng Rd, Wufeng District, Taichung",
    queries=["九二一地震教育園區, 臺中市", "921地震教育園區", "新生路192號, 霧峰區, 臺中市"])
add(id="tc-macaron-park", name="Macaron Park", city="Taichung", district="Taiping", category="attraction", tags=K,
    why="Playground, 11 m slide; open 24 hours",
    sources=[mich("Taichung Tourism: family fun", "https://travel.taichung.gov.tw/en/experience/family-fun")],
    address="No. 19, Sec. 4, Huanzhong E Rd, Taiping District, Taichung",
    queries=["馬卡龍公園, 臺中市", "Macaron Park, Taichung", "環中東路四段19號, 太平區, 臺中市"],
    source_geo=(24.1476748, 120.7127875))  # from the Google Maps link on the Taichung Tourism page
add(id="tc-lixin-park", name="Lixin Park", city="Taichung", district="Xitun", category="attraction", tags=K,
    why="Nine climbing-net structures",
    sources=[mich("Taichung Tourism: family fun", "https://travel.taichung.gov.tw/en/experience/family-fun")],
    address="No. 1, Sec. 5, Longfu Rd, Xitun District, Taichung",
    queries=["黎新公園, 臺中市", "Lixin Park, Taichung", "龍富路五段1號, 西屯區, 臺中市"],
    source_geo=(24.1527099, 120.6257592), gmaps_query="黎新公園 臺中市")  # Chinese name from the source page's map link  # from the Google Maps link on the Taichung Tourism page
add(id="tc-taichung-park", name="Taichung Park", city="Taichung", district="Central", category="attraction", tags=K,
    why="Lake and pavilion; walk to Yizhong Night Market",
    sources=[mich("Nick Kembel: Taichung", KEMBEL_TC)],
    queries=["臺中公園, 臺中市", "中山公園, 北區, 臺中市", "Taichung Park"])
add(id="tc-calligraphy-greenway", name="Calligraphy Greenway", city="Taichung", district="West", category="attraction", tags=K,
    why="3.6 km green strip past museums and Shenji New Village",
    sources=[mich("Nick Kembel: Taichung", KEMBEL_TC)],
    queries=["草悟道, 臺中市", "Calligraphy Greenway, Taichung"], allow_road=True)
add(id="tc-national-taichung-theater", name="National Taichung Theater", city="Taichung", district="Xitun", category="attraction", tags=K,
    why="Toyo Ito opera house; free photo stop",
    sources=[mich("Nick Kembel: Taichung", KEMBEL_TC)],
    queries=["臺中國家歌劇院, 臺中市", "National Taichung Theater"])
add(id="tc-bugcat-capoo-house", name="BugCat Capoo House", city="Taichung", district="West", category="attraction", tags=K,
    why="Capoo store; closed Tuesdays",
    sources=[mich("Nick Kembel: Taichung", KEMBEL_TC)], address="No. 23, Lane 8, Mofan St, West District, Taichung",
    queries=["咖波屋, 臺中市", "模範街8巷23號, 西區, 臺中市", "模範街8巷, 西區, 臺中市"])
add(id="tc-rainbow-village", name="Rainbow Village", city="Taichung", district="Nantun", category="attraction", tags=K,
    why="Painted village, smaller since 2022; closed Mondays",
    sources=[mich("Nick Kembel: Taichung", KEMBEL_TC)], address="Chun'an Rd, Nantun District, Taichung",
    queries=["彩虹眷村, 臺中市", "Rainbow Village, Taichung"])
add(id="tc-gaomei-wetland", name="Gaomei Wetland", city="Taichung", district="Qingshui", category="attraction", tags=K,
    why="Boardwalk and wind turbines; best at low tide and sunset",
    sources=[mich("Nick Kembel: Taiwan with kids", "https://www.nickkembel.com/taiwan-with-kids/")],
    queries=["高美濕地, 臺中市", "Gaomei Wetland"])
add(id="tc-lihpao-land", name="Lihpao Land 麗寶樂園", city="Taichung", district="Houli", category="attraction", tags=K,
    why="Theme park and pet farm; go on a weekday",
    sources=[mich("Expedia: Taichung things to do", "https://www.expedia.com/Things-To-Do-In-Taichung.d6177563.Travel-Guide-Activities")],
    address="No. 8, Furong Rd, Houli District, Taichung",
    queries=["麗寶樂園, 臺中市", "Lihpao Land", "福容路8號, 后里區, 臺中市"], gmaps_query="麗寶樂園 臺中市")
add(id="tp-taipei-zoo-maokong", name="Taipei Zoo + Maokong Gondola", city="Taipei", district="Wenshan", category="attraction", tags=K,
    why="Classic family day out",
    sources=[mich("Taipei Tourism: Taipei with kids", "https://www.taipeitourism.org/taipei-with-kids/")],
    queries=["臺北市立動物園, 臺北市", "Taipei Zoo"], gmaps_query="Taipei Zoo")
add(id="tp-taipei-101-observatory", name="Taipei 101 Observatory", city="Taipei", district="Xinyi", category="attraction", tags=K,
    why="City views",
    sources=[mich("Taiwan Obsessed: Taiwan with kids", "https://www.taiwanobsessed.com/taiwan-with-kids/")],
    queries=["台北101, 臺北市", "Taipei 101"])
add(id="tp-childrens-amusement-park", name="Taipei Children's Amusement Park", city="Taipei", district="Shilin", category="attraction", tags=K,
    why="Rides for younger kids",
    sources=[mich("Taiwanderers: Taipei things to do", "https://taiwanderers.com/taipei-things-to-do/")],
    queries=["臺北市立兒童新樂園, 臺北市", "兒童新樂園, 士林區", "Taipei Children's Amusement Park"])
add(id="tp-astronomical-museum", name="Taipei Astronomical Museum", city="Taipei", district="Shilin", category="attraction", tags=K,
    why="Indoor rainy-day option",
    sources=[mich("Sunny City Kids: Taipei with kids", "https://www.sunnycitykids.com/blog/best-things-to-do-in-taipei-with-kids")],
    queries=["臺北市立天文科學教育館, 臺北市", "天文科學教育館", "Taipei Astronomical Museum"])
add(id="tp-miramar-ferris-wheel", name="Miramar Ferris Wheel", city="Taipei", district="Zhongshan", category="attraction", tags=K,
    why="Rooftop Ferris wheel",
    sources=[mich("Justaiwan Tour: family tour", "https://www.justaiwantour.com/taipei-family-tour-kid-friendly-activities/")],
    queries=["美麗華摩天輪, 臺北市", "美麗華百樂園, 臺北市", "Miramar Entertainment Park"])
add(id="tp-airport-alley", name="Airport Alley", city="Taipei", district="Zhongshan", category="attraction", tags=K,
    why="Free; planes land just overhead",
    sources=[mich("Taiwanderers: Taipei with kids", "https://taiwanderers.com/taipei-with-kids-things-to-do/")],
    queries=["濱江街 飛機巷, 臺北市", "濱江街, 臺北市"], gmaps_query="飛機巷 濱江街 臺北市")

# 6.6 events
add(id="tp-event-voices-festival", name="VOICES 呼聲 music festival", city="Taipei", category="event",
    why="Music festival", startDate="2026-10-03", endDate="2026-10-04",
    sources=[mich("Bandsintown: Taipei", "https://www.bandsintown.com/c/taipei-city-taiwan")],
    queries=["大佳河濱公園, 臺北市", "Dajia Riverside Park"], gmaps_query="Dajia Riverside Park, Taipei")
add(id="tp-event-national-day-fireworks", name="Taipei 101 National Day fireworks, drones and lights (10 PM, ~14 min)", city="Taipei", category="event", tags=["kid-friendly"],
    why="View from the Taipei Civic Plaza area", startDate="2026-10-10", endDate="2026-10-10",
    sources=[mich("Taiwan Obsessed: Taiwan in October", "https://www.taiwanobsessed.com/taiwan-in-october/")],
    queries=["台北101, 臺北市", "Taipei 101"], gmaps_query="Taipei 101")
add(id="tp-event-chill-out-festival", name="Chill Out Music Festival (dates to confirm)", city="Taipei", category="event",
    why="Music festival in Gongguan", flag="Exact dates unconfirmed", startDate="2026-10-09", endDate="2026-10-11",
    sources=[mich("Taiwan Obsessed: Taiwan in October", "https://www.taiwanobsessed.com/taiwan-in-october/")],
    queries=["公館, 臺北市", "公館站, 臺北市", "Gongguan, Taipei"], gmaps_query="Gongguan, Taipei")
add(id="tp-event-taipei-jazz-festival", name="Taipei Jazz Festival concerts", city="Taipei", category="event",
    why="Concerts through October; various venues (pin at city center)", startDate="2026-10-01", endDate="2026-10-15",
    sources=[mich("Taiwan Obsessed: Taiwan in October", "https://www.taiwanobsessed.com/taiwan-in-october/")],
    queries=["臺北市", "Taipei"], city_center=True, gmaps_query="Taipei Jazz Festival")
add(id="tc-event-lets-hike-taichung", name="Let's Hike! Taichung!", city="Taichung", category="event",
    why="Ongoing hiking program; citywide (pin at city center)", startDate="2026-10-01", endDate="2026-10-15",
    sources=[mich("Taichung Tourism calendar", "https://travel.taichung.gov.tw/en/Event/TouristCalendar")],
    queries=["臺中市", "Taichung"], city_center=True, gmaps_query="Taichung hiking trails")

# ---------------------------------------------------------------- geocoding
VIEWBOX = {  # lon_min, lat_max, lon_max, lat_min  (Nominatim viewbox order)
    "Taichung": (120.45, 24.45, 121.45, 23.99),
    "Taipei": (121.45, 25.21, 121.67, 24.96),
}
DISTRICT_ZH = {
    "Central": "中區", "West": "西區", "North": "北區", "South": "南區", "East": "東區", "Xitun": "西屯區",
    "Nantun": "南屯區", "Beitun": "北屯區", "Taiping": "太平區", "Wufeng": "霧峰區", "Qingshui": "清水區",
    "Shalu": "沙鹿區", "Dongshi": "東勢區", "Houli": "后里區", "Wuqi": "梧棲區", "Zhongshan": "中山區",
    "Xinyi": "信義區", "Zhongzheng": "中正區", "Wanhua": "萬華區", "Datong": "大同區", "Wenshan": "文山區",
    "Shilin": "士林區", "Da'an": "大安區", "Songshan": "松山區",
}


def load_cache():
    if os.path.exists(CACHE):
        return json.load(open(CACHE, encoding="utf-8"))
    return {}


_last = [0.0]


def nominatim(q, city, cache, city_center=False):
    key = f"{city}|{q}"
    if key in cache:
        return cache[key]
    wait = 1.1 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    params = {"q": q, "format": "jsonv2", "limit": "1", "countrycodes": "tw", "addressdetails": "1",
              "accept-language": "zh-TW,en"}
    if not city_center:
        vb = VIEWBOX[city]
        params.update({"viewbox": ",".join(map(str, vb)), "bounded": "1"})
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    _last[0] = time.time()
    cache[key] = data[0] if data else None
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return cache[key]


def dist_m(a, b):
    R_ = 6371000
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_ * math.asin(math.sqrt(h))


def in_city(city, lat, lng):
    lo1, la2, lo2, la1 = VIEWBOX[city]
    return la1 <= lat <= la2 and lo1 <= lng <= lo2


def district_of(res):
    a = (res or {}).get("address", {})
    return a.get("city_district") or a.get("suburb") or a.get("district") or ""


def check(r, la, lo, res):
    """Return a reason string if this Nominatim hit should be rejected, else None."""
    if not in_city(r["city"], la, lo):
        return f"{la:.5f},{lo:.5f} is outside {r['city']}"
    for label, pin in (("the Michelin page's map pin", r.get("michelin_geo")), ("the source's map link", r.get("source_geo"))):
        if pin:
            d = dist_m((la, lo), pin)
            if d > 250:
                return f"{d:.0f} m from {label} (matched “{res.get('display_name','')[:40]}…”)"
    if r.get("city_center"):
        return None
    if res.get("addresstype") == "road" and not r.get("allow_road") and not (r.get("michelin_geo") or r.get("source_geo")):
        return f"only matched a street ({res.get('name')}), too imprecise"
    want = DISTRICT_ZH.get(r["district"] or "")
    got = district_of(res)
    if r.get("strict_district") and want and want not in got:
        return f"matched “{res.get('name')}” in {got}, but this branch is in {r['district']} ({want})"
    return None


def write_report(places, fails, notes, debug):
    need = [p for p in places if p["lat"] is None]
    L = ["# Geocode report", "",
         "Generated by `tools/build_places.py` on the data in the build spec, section 6.",
         "Geocoder: OpenStreetMap Nominatim (public API, 1 request/second, identifying User-Agent, results cached in `tools/geocode_cache.json`).",
         "", "Rows from Calvin's Google Maps list (6.1–6.3) were used as given and are not geocoded.",
         "District labels for 6.4 rows come from each Michelin page's address or the spec's hints; they are used only for this sanity check.",
         "", "A result was rejected when it fell outside the city, landed more than 250 m from the pin the linked source itself publishes "
         "(Michelin page / Taichung Tourism map link), only matched a whole street, or matched a different branch.",
         "", f"## Needs location ({len(need)})", "",
         "These have `lat: null`. They show in the app's **Needs location** list; open one and use **Fix location**, then tap the map.", ""]
    by_id = {r["id"]: tried for r, tried in fails}
    for p in need:
        L.append(f"### {p['name']} (`{p['id']}`)")
        if p.get("address"):
            L.append(f"- Address from source: {p['address']}")
        src = next((x for x in R if x["id"] == p["id"]), {})
        if src.get("michelin_geo"):
            la, lo = src["michelin_geo"]
            L.append(f"- The Michelin page's own map pin is {la}, {lo} (not used: the spec says to geocode with Nominatim only)")
        for t in by_id.get(p["id"], []):
            L.append(f"- Tried {t}")
        if src.get("report_note"):
            L.append(f"- Note: {src['report_note']}")
        L.append("")
    L += ["## Geocoded, with notes", ""]
    if notes:
        for r, n in notes:
            L.append(f"- **{r['name']}** (`{r['id']}`): {n}")
    else:
        L.append("- None")
    L += ["", "## Geocoded OK", "", "| id | query used | OSM match |", "| --- | --- | --- |"]
    for pid, d in debug.items():
        if d["status"] is None:
            L.append(f"| `{pid}` | {d['query']} | {(d['display'] or '')[:80]} |")
    L += ["", "## Approximate by design", "",
          "- **Taipei Jazz Festival** and **Let's Hike! Taichung!** are pinned at the OSM city centre point, as the spec says (\"pin at city center\").",
          "- **Taipei 101 National Day fireworks** is pinned on Taipei 101; the spec suggests viewing from the Civic Plaza area.",
          "- **Chill Out Music Festival** is pinned at the OSM \"Gongguan\" area point; the exact venue is not in the source.",
          "- **Taipei Zoo + Maokong Gondola** is one pin at the zoo.", ""]
    open(os.path.join(ROOT, "GEOCODE_REPORT.md"), "w", encoding="utf-8").write("\n".join(L))


def main():
    cache = load_cache()
    places, report_fail, report_notes = [], [], []

    for (pid, name, city, district, cat, tags, lat, lng, cid, why, flag) in LISTED:
        places.append({
            "id": pid, "name": name, "city": city, "district": district, "lat": lat, "lng": lng,
            "category": cat, "tags": tags, "why": why, "notes": "",
            "sources": [{"label": "Calvin's Google Maps list", "url": cidlink(cid)}],
            "gmaps": cidlink(cid), "hours": None, "startDate": None, "endDate": None,
            "address": None, "flag": flag,
        })

    for r in R:
        lat = lng = used_q = hit = status = None
        tried = []
        for q in r["queries"]:
            res = nominatim(q, r["city"], cache, r.get("city_center", False))
            if not res:
                tried.append(f"“{q}”: no result")
                continue
            la, lo = float(res["lat"]), float(res["lon"])
            problem = check(r, la, lo, res)
            if problem:
                tried.append(f"“{q}”: {problem}")
                continue
            lat, lng, used_q, hit = la, lo, q, res
            break
        entry = {"id": r["id"], "name": r["name"], "city": r["city"], "district": r["district"],
                 "lat": None, "lng": None, "category": r["category"], "tags": r["tags"], "why": r["why"],
                 "notes": "", "sources": r["sources"],
                 "gmaps": gsearch(r["gmaps_query"] or gmaps_text(r)),
                 "hours": r["hours"], "startDate": r["startDate"], "endDate": r["endDate"],
                 "address": r["address"], "flag": r["flag"]}
        if r["id"] in ZH:
            entry["nameZh"], entry["addressZh"] = ZH[r["id"]]
        if lat is None:
            status = "; ".join(tried)
            report_fail.append((r, tried))
        else:
            entry["lat"], entry["lng"] = round(lat, 6), round(lng, 6)
            got = district_of(hit)
            want = DISTRICT_ZH.get(r["district"] or "")
            if want and got and want not in got:
                report_notes.append((r, f"OSM puts the match in {got}; the spec/hint says {r['district']} ({want}). "
                                        f"Named match “{hit.get('name')}”, kept."))
        entry["_geocode"] = {"query": used_q, "display": hit.get("display_name") if hit else None, "status": status}
        places.append(entry)

    # Strip debug info before writing, but keep it for the report
    debug = {p["id"]: p.pop("_geocode") for p in places if "_geocode" in p}
    with open(os.path.join(ROOT, "places.json"), "w", encoding="utf-8") as f:
        json.dump(places, f, ensure_ascii=False, indent=2)
    json.dump(debug, open(os.path.join(ROOT, "tools", "geocode_debug.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    write_report(places, report_fail, report_notes, debug)
    print(f"wrote {len(places)} places; {len(report_fail)} need location")
    for r, tried in report_fail:
        print(" FAIL", r["id"], "|", " / ".join(tried))
    for r, n in report_notes:
        print(" note", r["id"], "|", n)

if __name__ == "__main__":
    main()
