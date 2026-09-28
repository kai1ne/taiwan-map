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
| `tools/fetch_photos.py`, `tools/photo_cache.json` | Adds a free Wikimedia Commons photo to places that have one (run after editing places.json; cached) |

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
- Optional **photo**: `{"src": "https://upload.wikimedia.org/…", "page": "…", "credit": "Author, CC BY-SA 4.0 · Wikimedia Commons"}`. `python3 tools/fetch_photos.py` fills this in automatically; it only uses a photo when the Wikidata entry's own coordinates are near the pin. Keep the credit — the photo licences require it.

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

- **Main panel (Places):** a list of every place with filter chips and a search box on top; the list and the map markers change together as you filter. On a phone it's a bottom sheet — drag or tap the grey handle for small / half / full height. On a wider screen it's a sidebar on the left. The list is A–Z (current city first), never sorted by distance; when GPS is on, each row shows how far away it is.
- **Place card:** a photo where a free one exists (Wikimedia Commons, credited), the why, sources, hours or "check Google Maps", flags, notes, **🚶 Walking directions** (opens Google Maps walking directions from where you are) and **Google Maps** (live hours, reviews, more photos).
- **Location:** tap the arrow button to show the blue dot and follow you as you walk; drag the map to stop following. Needs location permission.
- **Filters:** category chips show or hide each category. **★ Michelin** and **Kid-friendly** narrow to places with that tag; with both on, you see places with either. Home bases always show.
- **Events** appear only on their dates. The date pill at the top lets you pretend it's another day. **All events** ignores dates. On Oct 9–11 a National Day long-weekend banner shows.
- **Visited** greys the marker and adds a green ✓. The place never disappears.
- **Add place:** the Add tab, or long-press the map. Location comes from GPS or a tap on the map. Your places can be edited and deleted; curated ones can't be deleted.
- **Fix location** on any place: tap it, then tap the map. **Undo my location fix** restores the curated position.
- **Day plan:** pick a date (Oct 1–15) and a start (home base by default). The top half is the day's timeslots (07:00–23:00 plus "Any time"); the bottom half is a filterable place list. Drag a place's ⠿ handle onto a time, or tap a time and pick a place. Drag a stop's ⠿ to move it to another time; edit the minutes in its time box. **Suggest order** puts stops in nearest-next walking order from the start and hands your chosen times out in that order. Between stops you see straight-line distance and estimated walking time (about 80 m/min), a "probably not walkable" warning over 2 km, and a **Directions** link that opens that leg in Google Maps. Hours warnings appear when the snapshot says a place is closed; nothing is ever blocked. The "Nearby" menu narrows the list to places within about 1 km of the map centre, you, or a stop.

## Data credits

Map tiles and geocoded coordinates © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). Hours are a snapshot from the linked Michelin pages and blogs as of Sept 2026. Always check Google Maps before going.
