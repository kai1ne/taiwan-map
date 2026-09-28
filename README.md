# Taiwan Map

A phone-first map of about 100 curated places in Taichung and Taipei for the Oct 1–15, 2026 trip. It's a plain static site: HTML, CSS, and JavaScript with no build step, no server, no accounts, and no API keys.

- Map: [Leaflet 1.9.4](https://leafletjs.com/) + OpenStreetMap tiles (© OpenStreetMap contributors)
- Places: `places.json` (curated, read-only in the app)
- Your changes (visited marks, notes, added places, location fixes, day plans): saved in the phone browser's `localStorage`

## Files

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app |
| `places.json` | The curated place list |
| `manifest.webmanifest`, `*.png` | Home-screen name and icon |
| `GEOCODE_REPORT.md` | Places that still need a location, and how each was geocoded |
| `tools/build_places.py` | The script that built `places.json` from the build spec (kept as a record) |
| `tools/geocode_cache.json` | Cached Nominatim answers, so a rebuild sends no new requests |

## Add or update a curated place

Edit `places.json` directly in any text editor, or on github.com by clicking the file and then the pencil icon. Each place is one object:

```json
{
  "id": "tc-my-new-place",
  "name": "My New Place",
  "city": "Taichung",
  "district": "West",
  "lat": 24.1512,
  "lng": 120.6632,
  "category": "food",
  "tags": ["michelin"],
  "why": "One line on why it's on the list",
  "notes": "",
  "sources": [{ "label": "Blog post", "url": "https://example.com" }],
  "gmaps": "https://www.google.com/maps/search/?api=1&query=My%20New%20Place%20Taichung",
  "hours": null,
  "startDate": null,
  "endDate": null,
  "address": null,
  "flag": null
}
```

- **id**: unique and never changed later. Your visited marks and notes are keyed by it.
- **category**: one of `food`, `shopping`, `film-lab`, `attraction`, `event`, `home-base`.
- **tags**: any of `michelin`, `kid-friendly`, `streetwear`, `vintage`, `film-gear`.
- **lat / lng**: to copy them from Google Maps, long-press the spot (phone) or right-click it (computer), then tap the numbers. Use `null` if unknown, and the place will show up under **More → Needs location**.
- **gmaps**: prefer `https://maps.google.com/?cid=…` when you have one. Otherwise use a search link. A search on an English name plus city often opens the wrong place, so a Chinese name plus address works best, e.g. `…query=滬舍餘味%20臺中市南屯區公益路二段537號`. Test the link once.
- **hours**: `null`, or one entry per day: `{"mon": [["11:00","14:30"]], "tue": [], …}`. An empty list means closed that day. A day left out means unknown. An end time earlier than the start, like `["17:00","02:00"]`, runs past midnight. Only enter hours a real source states.
- **startDate / endDate** (events only): `"2026-10-03"`. The event shows on the map only on those dates.
- **flag**: optional warning shown on the card, e.g. `"May have closed — check before going"`.
- Optional **nameZh / addressZh**: Chinese name and address, shown large on the card (handy for taxis).

Check the JSON is valid (every comma and quote), save, and redeploy (below). If the map goes blank after an edit, the JSON almost always has a typo.

`tools/build_places.py` rebuilds `places.json` from scratch, so **don't run it after hand edits** or they'll be overwritten. It's kept as a record of how the first version was built. If you do change and re-run it, it reads `tools/geocode_cache.json` first and only calls Nominatim for new queries: at most 1 request per second, following the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).

## Redeploy (GitHub Pages)

Any change to the files in the repository goes live on its own within a minute or two:

1. Open the repository on github.com.
2. To edit one file: click it, click the pencil icon, make the change, then **Commit changes**.
3. To replace files: **Add file → Upload files**, drag them in, then **Commit changes**.
4. Wait about a minute, then reload the app. If the phone shows the old version, close the tab and reopen it.

To preview locally first: in this folder, run `python3 -m http.server 8000` and open http://localhost:8000. The file has to be served over http; opening `index.html` directly won't load `places.json`.

## Backup and restore

Your own data lives only in the browser on your phone. It's lost if you clear Safari/Chrome website data or switch phones, and a home-screen app keeps its own separate storage from the browser tab.

- **Back up:** More → **Export my data**. This downloads `taiwan-map-backup-YYYY-MM-DD.json`. Save it to Files, iCloud Drive, or email it to yourself.
- **Restore:** More → **Import**, then pick that file. It *replaces* what's on the phone with the backup (you'll be asked to confirm).
- The backup holds visited marks, notes, added places, location fixes, day plans, and settings. It does not include the curated list, which comes from `places.json`.

## How the app behaves

- Opens on the home base, 國泰美術觀道. **Taichung / Taipei** at the top jumps between the cities.
- Places are never sorted by distance. The map shows what's near you, and lists are alphabetical or grouped by category.
- **Filters:** category chips show or hide each category. **★ Michelin** and **Kid-friendly** narrow the map to places with that tag; with both on, you see places with either tag. Home bases always show.
- **Events** appear only on their dates. The date pill at the top ("Today: …") lets you pretend it's another day for planning. **Show all events** ignores dates. On Oct 9–11 a National Day long-weekend banner shows.
- **Visited** greys the marker and adds a green ✓. The place never disappears.
- **Add place:** the button, or long-press the map. The location comes from GPS or a tap on the map. Places you add can be edited and deleted; curated ones can't be deleted.
- **Fix location** on any place: tap it, then tap the map. **Undo my location fix** restores the curated position.
- **Day plan:** pick a date (Oct 1–15) and a start (home base by default). Add places or custom entries with times and reorder with ↑/↓. **Suggest walking order** orders stops by nearest-next from the start. Distances are straight lines and times assume about 80 m/min; both are estimates. Legs over 2 km are marked "probably not walkable". Hours warnings appear when the snapshot says a place is closed on that day or at that time. Nothing is ever blocked. **Nearby ideas** lists places within about 1 km.

## Data credits

Map tiles and geocoded coordinates © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). Hours are a snapshot from the linked Michelin pages and blogs as of Sept 2026. Always check Google Maps before going.
