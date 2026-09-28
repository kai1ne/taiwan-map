#!/usr/bin/env python3
"""Add a free photo to places in places.json, from Wikimedia Commons via Wikidata.

For each place with coordinates, search Wikidata by name (English, and the Chinese
part of the name when there is one). A candidate is accepted only if it has an
image (P18) AND its own coordinates (P625) are close to our pin, so a shop never
gets a same-named landmark's photo. Most small shops have no Wikidata entry and
get no photo; the card then relies on "Open in Google Maps" for photos.

Writes "photo": {"src", "page", "credit"} into places.json. Answers are cached in
tools/photo_cache.json, so re-running only asks about new places.

Usage: python3 tools/fetch_photos.py
"""
import html, json, math, os, re, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "tools", "photo_cache.json")
UA = "TaiwanTripMap/1.1 (personal non-commercial trip map; one-off photo lookup)"
MAX_M = {"attraction": 1500, "event": 400}  # big parks/wetlands get more slack
DEFAULT_MAX_M = 400


def get(url, params):
    for attempt in range(5):
        time.sleep(1.0)  # stay well under Wikimedia's limits
        req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == 4:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or 10 * (attempt + 1)
            print(f"  (rate limited, waiting {wait}s)")
            time.sleep(wait)


def dist_m(a, b):
    R = 6371000
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def search_terms(p):
    name = p["name"]
    terms = []
    latin = re.sub(r"\(.*?\)|（.*?）", "", name)
    latin = re.sub(r"[　-鿿＀-￯]+", " ", latin).strip(" -‧·")
    latin = re.sub(r"\s+", " ", latin).strip()
    if len(latin) >= 3:
        terms.append((latin, "en"))
    zh = p.get("nameZh") or "".join(re.findall(r"[㐀-鿿]+", re.sub(r"\(.*?\)|（.*?）", "", name)))
    if zh and len(zh) >= 2:
        terms.append((zh, "zh"))
    return terms


def find_photo(p, cache):
    key = p["id"]
    if key in cache:
        return cache[key]
    ids = []
    for term, lang in search_terms(p):
        d = get("https://www.wikidata.org/w/api.php", {"action": "wbsearchentities", "search": term, "language": lang,
                                                        "uselang": lang, "limit": 7, "format": "json", "type": "item"})
        ids += [x["id"] for x in d.get("search", []) if x["id"] not in ids]
    result = None
    if ids:
        ents = get("https://www.wikidata.org/w/api.php", {"action": "wbgetentities", "ids": "|".join(ids[:40]),
                                                         "props": "claims|labels", "languages": "en|zh-tw|zh", "format": "json"})
        best = None
        for qid in ids:
            e = ents.get("entities", {}).get(qid, {})
            cl = e.get("claims", {})
            try:
                img = cl["P18"][0]["mainsnak"]["datavalue"]["value"]
                c = cl["P625"][0]["mainsnak"]["datavalue"]["value"]
            except (KeyError, IndexError):
                continue
            d_m = dist_m((p["lat"], p["lng"]), (c["latitude"], c["longitude"]))
            if d_m <= MAX_M.get(p["category"], DEFAULT_MAX_M) and (best is None or d_m < best[0]):
                best = (d_m, qid, img)
        if best:
            d_m, qid, img = best
            info = get("https://commons.wikimedia.org/w/api.php", {"action": "query", "titles": "File:" + img, "prop": "imageinfo",
                                                                  "iiprop": "url|extmetadata", "iiurlwidth": 800, "format": "json"})
            page = next(iter(info["query"]["pages"].values()))
            ii = (page.get("imageinfo") or [{}])[0]
            meta = ii.get("extmetadata", {})
            artist = re.sub(r"<[^>]+>", "", html.unescape(meta.get("Artist", {}).get("value", ""))).strip()
            lic = meta.get("LicenseShortName", {}).get("value", "")
            if ii.get("thumburl"):
                result = {"src": ii["thumburl"], "page": ii.get("descriptionurl"),
                          "credit": ", ".join(x for x in [artist[:80], lic] if x) + " · Wikimedia Commons",
                          "wikidata": qid, "distance_m": round(d_m)}
    cache[key] = result
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return result


def main():
    cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
    path = os.path.join(ROOT, "places.json")
    places = json.load(open(path, encoding="utf-8"))
    found = 0
    for p in places:
        p.pop("photo", None)
        if p.get("lat") is None or p["category"] == "home-base":
            continue
        r = find_photo(p, cache)
        if r:
            credit = re.sub(r"\s+", " ", r["credit"].split("\n")[0]).strip()
            if "·" not in credit:  # first line lost the licence part; keep the tail that has it
                credit = re.sub(r"\s+", " ", r["credit"].split("\n")[0][:60] + " … " + r["credit"].rsplit(",", 1)[-1]).strip()
            p["photo"] = {"src": r["src"], "page": r["page"], "credit": credit}
            found += 1
            print(f"  photo  {p['id']:34} {r['wikidata']:>10} {r['distance_m']:>5} m  {r['credit'][:50]}")
    json.dump(places, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"{found} of {len(places)} places have a photo")


if __name__ == "__main__":
    main()
