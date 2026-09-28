/* Taiwan Map — plain JS, no build step.
 * Curated places come from places.json; everything the user changes lives in
 * localStorage under STORE_KEY (see "state" below). No paid APIs, no keys. */
(function () {
  'use strict';

  // ------------------------------------------------------------------ constants
  const STORE_KEY = 'twmap.v1';
  const HOME_ID = 'tc-home-meishuguandao';
  const TRIP_START = '2026-10-01';
  const TRIP_END = '2026-10-15';
  const LONG_WEEKEND = ['2026-10-09', '2026-10-11'];
  const WALK_M_PER_MIN = 80;
  const FAR_M = 2000;
  const NEARBY_M = 1000;
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // JS getDay() order
  const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_FULL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

  const CATS = {
    'food': { label: 'Food', glyph: '🍜', color: 'var(--c-food)' },
    'shopping': { label: 'Shopping', glyph: '🛍️', color: 'var(--c-shopping)' },
    'film-lab': { label: 'Film lab', glyph: '🎞️', color: 'var(--c-film-lab)' },
    'attraction': { label: 'Attraction', glyph: '🎡', color: 'var(--c-attraction)' },
    'event': { label: 'Event', glyph: '🎉', color: 'var(--c-event)' },
    'home-base': { label: 'Home base', glyph: '🏠', color: 'var(--c-home-base)' },
  };
  const FILTER_CATS = ['food', 'shopping', 'film-lab', 'attraction', 'event'];
  const TAGS = ['michelin', 'kid-friendly', 'streetwear', 'vintage', 'film-gear'];
  const TAG_LABEL = { 'michelin': 'Michelin', 'kid-friendly': 'Kid-friendly', 'streetwear': 'Streetwear', 'vintage': 'Vintage', 'film-gear': 'Film gear' };

  // ------------------------------------------------------------------ state
  function defaultState() {
    return {
      visited: {},        // id -> true
      notes: {},          // id -> string (overrides curated notes)
      userPlaces: [],     // places the user added
      locOverrides: {},   // curated id -> {lat, lng} from "Fix location"
      itineraries: {},    // 'YYYY-MM-DD' -> {start: id|'me', stops: [...]}
      settings: {
        cats: { 'food': true, 'shopping': true, 'film-lab': true, 'attraction': true, 'event': true },
        tags: { 'michelin': false, 'kid-friendly': false },
        allEvents: false,
        todayOverride: null,
        itinDate: null,
        showRoute: true,
        city: 'Taichung',
      },
    };
  }
  function mergeState(raw) {
    const d = defaultState();
    if (!raw || typeof raw !== 'object') return d;
    const s = Object.assign(d, raw);
    s.settings = Object.assign(defaultState().settings, raw.settings || {});
    s.settings.cats = Object.assign(defaultState().settings.cats, (raw.settings || {}).cats || {});
    s.settings.tags = Object.assign(defaultState().settings.tags, (raw.settings || {}).tags || {});
    ['visited', 'notes', 'locOverrides', 'itineraries'].forEach(k => { if (!s[k] || typeof s[k] !== 'object') s[k] = {}; });
    if (!Array.isArray(s.userPlaces)) s.userPlaces = [];
    return s;
  }
  function loadState() {
    try { return mergeState(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); }
    catch (e) { return defaultState(); }
  }
  let S = loadState();
  let storageOk = true;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); storageOk = true; }
    catch (e) { if (storageOk) toast('Could not save on this phone (storage blocked?)'); storageOk = false; }
  }

  let curated = [];
  let myPos = null;          // {lat, lng, acc}
  let pick = null;           // {text, onPick}

  // ------------------------------------------------------------------ helpers
  const $ = sel => document.querySelector(sel);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function pad(n) { return String(n).padStart(2, '0'); }
  function isoLocal(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function realToday() { return isoLocal(new Date()); }
  function today() { return S.settings.todayOverride || realToday(); }
  function fmtDate(s, opts) {
    return parseISO(s).toLocaleDateString('en-US', Object.assign({ weekday: 'short', month: 'short', day: 'numeric' }, opts || {}));
  }
  function tripDates() {
    const out = []; const d = parseISO(TRIP_START); const end = parseISO(TRIP_END);
    while (d <= end) { out.push(isoLocal(d)); d.setDate(d.getDate() + 1); }
    return out;
  }
  function toMin(t) { const [a, b] = t.split(':').map(Number); return a * 60 + b; }

  function distM(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function fmtDist(m) { return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`; }
  function walkMin(m) { return Math.max(1, Math.round(m / WALK_M_PER_MIN)); }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
  }

  // ------------------------------------------------------------------ places
  function allPlaces() {
    const cur = curated.map(p => {
      const o = S.locOverrides[p.id];
      return o ? Object.assign({}, p, { lat: o.lat, lng: o.lng, fixed: true }) : p;
    });
    return cur.concat(S.userPlaces.map(p => Object.assign({}, p, { user: true })));
  }
  function byId(id) { return allPlaces().find(p => p.id === id); }
  function hasLoc(p) { return p && typeof p.lat === 'number' && typeof p.lng === 'number'; }
  function needsLocation() { return allPlaces().filter(p => !hasLoc(p)); }
  function gmapsUrl(p) {
    if (p.gmaps) return p.gmaps;
    if (p.user && hasLoc(p)) return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${p.name} ${p.city || ''}`.trim());
  }
  function eventActive(p, day) { return p.startDate && p.endDate && day >= p.startDate && day <= p.endDate; }

  function isShown(p) {
    if (!hasLoc(p)) return false;
    if (p.category === 'home-base') return true;
    if (!S.settings.cats[p.category]) return false;
    if (p.category === 'event' && !S.settings.allEvents && !eventActive(p, today())) return false;
    const tagOn = Object.keys(S.settings.tags).filter(t => S.settings.tags[t]);
    if (tagOn.length && !tagOn.some(t => (p.tags || []).includes(t))) return false;
    return true;
  }

  // ------------------------------------------------------------------ hours
  // hours = {mon: [["11:00","14:00"]], ..., sun: []}; [] = closed; missing day = unknown.
  // An end time earlier than the start ("17:00","02:00") runs past midnight.
  function hoursStatus(p, dateISO, time) {
    const hrs = p && p.hours;
    if (!hrs) return null;
    const d = parseISO(dateISO);
    const day = DAYS[d.getDay()];
    const prev = DAYS[(d.getDay() + 6) % 7];
    const todays = hrs[day];
    if (todays === undefined) return null;
    const carry = (hrs[prev] || []).filter(([s, e]) => toMin(e) < toMin(s));
    if (!time) {
      if (todays.length === 0 && carry.length === 0) return { closed: true, msg: `Closed on ${DAY_FULL[day]}s (hours snapshot)` };
      return null;
    }
    const t = toMin(time);
    const open = todays.some(([s, e]) => {
      const a = toMin(s), b = toMin(e);
      return b > a ? (t >= a && t < b) : t >= a;
    }) || carry.some(([, e]) => t < toMin(e));
    if (open) return null;
    if (todays.length === 0) return { closed: true, msg: `Closed on ${DAY_FULL[day]}s (hours snapshot)` };
    return { closed: true, msg: `May be closed at ${time} — ${DAY_LABEL[day]} hours: ${fmtRanges(todays)}` };
  }
  function fmtRanges(r) {
    if (!r || !r.length) return 'closed';
    return r.map(([s, e]) => `${s}–${e}${toMin(e) < toMin(s) ? ' (next day)' : ''}`).join(', ');
  }

  // ------------------------------------------------------------------ map
  const map = L.map('map', { zoomControl: true, tap: false }).setView([24.135834, 120.664215], 15);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);

  const cluster = L.markerClusterGroup({ maxClusterRadius: 28, spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: true });
  map.addLayer(cluster);
  const homeLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  const meLayer = L.layerGroup().addTo(map);
  let pickMarker = null;

  function markerIcon(p) {
    const c = CATS[p.category] || CATS.food;
    const cls = ['pm', p.category === 'home-base' ? 'pm-home' : '', p.user ? 'pm-user' : '', S.visited[p.id] ? 'pm-visited' : ''].join(' ');
    const size = p.category === 'home-base' ? 44 : 34;
    return L.divIcon({
      className: cls,
      html: `<div class="pm-dot" style="--c:${c.color}">${c.glyph}</div>${S.visited[p.id] ? '<span class="pm-check">✓</span>' : ''}`,
      iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    });
  }

  function renderMarkers() {
    cluster.clearLayers(); homeLayer.clearLayers();
    const add = [];
    for (const p of allPlaces()) {
      if (!isShown(p)) continue;
      const m = L.marker([p.lat, p.lng], { icon: markerIcon(p), title: p.name, keyboard: true, riseOnHover: true });
      m.on('click', () => { if (!pick) openPlace(p.id); });
      if (p.category === 'home-base') { m.setZIndexOffset(1000); homeLayer.addLayer(m); }
      else add.push(m);
    }
    cluster.addLayers(add);
    const n = needsLocation().length;
    const b = $('#needBadge'); b.hidden = n === 0; b.textContent = n;
  }

  // ------------------------------------------------------------------ top bar / filters
  function renderTop() {
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b.dataset.city === S.settings.city));
    const pill = $('#datePill');
    const ov = !!S.settings.todayOverride;
    pill.textContent = (ov ? 'Planning: ' : 'Today: ') + fmtDate(today());
    pill.classList.toggle('override', ov);
    const t = today();
    $('#banner').hidden = !(t >= LONG_WEEKEND[0] && t <= LONG_WEEKEND[1]);
  }

  function renderFilters() {
    const f = $('#filters'); f.textContent = '';
    for (const c of FILTER_CATS) {
      f.appendChild(h('button', {
        type: 'button', class: 'chip' + (S.settings.cats[c] ? ' on' : ''), style: `--chip:${CATS[c].color}`,
        'aria-pressed': String(!!S.settings.cats[c]),
        onclick: () => { S.settings.cats[c] = !S.settings.cats[c]; save(); renderFilters(); renderMarkers(); },
      }, h('span', { class: 'dot' }), CATS[c].label));
    }
    [['michelin', '★ Michelin'], ['kid-friendly', 'Kid-friendly']].forEach(([t, label], i) => {
      f.appendChild(h('button', {
        type: 'button', class: 'chip' + (S.settings.tags[t] ? ' on' : '') + (i === 0 ? ' sep' : ''), 'aria-pressed': String(!!S.settings.tags[t]),
        onclick: () => { S.settings.tags[t] = !S.settings.tags[t]; save(); renderFilters(); renderMarkers(); },
      }, label));
    });
    f.appendChild(h('button', {
      type: 'button', class: 'chip sep' + (S.settings.allEvents ? ' on' : ''), style: '--chip:var(--c-event)', 'aria-pressed': String(!!S.settings.allEvents),
      onclick: () => { S.settings.allEvents = !S.settings.allEvents; save(); renderFilters(); renderMarkers(); toast(S.settings.allEvents ? 'Showing all events, any date' : 'Showing only events on ' + fmtDate(today())); },
    }, 'Show all events'));
  }

  function goCity(city, animate) {
    S.settings.city = city; save(); renderTop();
    if (city === 'Taichung') {
      const home = byId(HOME_ID);
      map.setView([home.lat, home.lng], 15, { animate });
    } else {
      const pts = allPlaces().filter(p => p.city === 'Taipei' && hasLoc(p)).map(p => [p.lat, p.lng]);
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 15, animate });
    }
  }

  // ------------------------------------------------------------------ sheet
  let sheetBackFn = null;
  function openSheet(title, body, back) {
    $('#sheetTitle').textContent = title;
    const b = $('#sheetBody'); b.textContent = ''; b.appendChild(body); b.scrollTop = 0;
    sheetBackFn = back || null; $('#sheetBack').hidden = !back;
    $('#sheet').hidden = false;
  }
  function closeSheet() { $('#sheet').hidden = true; sheetBackFn = null; }
  let currentSheet = null; // a function that re-renders the open sheet
  function show(fn) { currentSheet = fn; fn(); }
  function refreshSheet() { if (!$('#sheet').hidden && currentSheet) currentSheet(); }

  // ------------------------------------------------------------------ pick mode
  function startPick(text, onPick) {
    pick = { text, onPick };
    $('#pickText').textContent = text; $('#pickBar').hidden = false;
    $('#sheet').hidden = true;
  }
  function endPick() {
    pick = null; $('#pickBar').hidden = true;
    if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; }
  }
  $('#pickCancel').addEventListener('click', () => { endPick(); if (currentSheet) { $('#sheet').hidden = false; } });

  map.on('click', e => {
    if (!pick) return;
    const cb = pick.onPick; endPick(); cb({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) });
  });

  // Long-press anywhere on the map drops a pin for a new place.
  (function longPress() {
    const el = map.getContainer();
    let timer = null, start = null, fired = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.leaflet-marker-icon, .leaflet-control')) return;
      fired = false; start = { x: e.clientX, y: e.clientY };
      cancel();
      timer = setTimeout(() => {
        fired = true;
        const rect = el.getBoundingClientRect();
        const ll = map.containerPointToLatLng([start.x - rect.left, start.y - rect.top]);
        dropPin({ lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) });
      }, 600);
    });
    el.addEventListener('pointermove', e => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => el.addEventListener(t, cancel));
    el.addEventListener('touchstart', e => { if (e.touches.length > 1) cancel(); }, { passive: true });
    el.addEventListener('contextmenu', e => { e.preventDefault(); });
    // A long press shouldn't also count as a tap in pick mode.
    el.addEventListener('click', e => { if (fired) { e.stopPropagation(); fired = false; } }, true);
  })();

  function dropPin(ll) {
    if (pick) { const cb = pick.onPick; endPick(); cb(ll); return; }
    show(() => placeForm(null, { lat: ll.lat, lng: ll.lng }));
  }
  function showPickMarker(ll) {
    if (pickMarker) map.removeLayer(pickMarker);
    pickMarker = L.marker([ll.lat, ll.lng], { icon: L.divIcon({ className: 'pick-pin', html: '📍', iconSize: [34, 34], iconAnchor: [17, 32] }) }).addTo(map);
  }

  // ------------------------------------------------------------------ place card
  function openPlace(id, back) { show(() => placeCard(id, back)); }

  function placeCard(id, back) {
    const p = byId(id);
    if (!p) { closeSheet(); return; }
    const c = CATS[p.category] || CATS.food;
    const body = h('div', { class: 'stack' });

    body.appendChild(h('div', { class: 'row' },
      h('span', { class: 'badge cat', style: `--chip:${c.color}` }, c.label),
      (p.tags || []).map(t => h('span', { class: 'badge' }, TAG_LABEL[t] || t)),
      p.user ? h('span', { class: 'badge' }, 'Added by you') : null,
      h('span', { class: 'muted small' }, [p.district, p.city].filter(Boolean).join(', ')),
    ));
    if (p.flag) body.appendChild(h('div', { class: 'flag' }, '⚠️ ' + p.flag));
    if (p.startDate) {
      const on = eventActive(p, today());
      body.appendChild(h('div', { class: on ? 'warn' : 'muted' },
        `📅 ${fmtDate(p.startDate)}${p.endDate && p.endDate !== p.startDate ? ' – ' + fmtDate(p.endDate) : ''}${on ? ' · on now' : ''}`));
    }
    if (p.nameZh && p.nameZh !== p.name) body.appendChild(h('div', { class: 'zh', lang: 'zh-Hant' }, p.nameZh));
    body.appendChild(h('div', { class: 'why' }, p.why ? p.why : (p.user ? '' : "From Calvin's Google Maps list")));
    if (p.addressZh) body.appendChild(h('div', { class: 'small', lang: 'zh-Hant' }, p.addressZh));
    if (p.address) body.appendChild(h('div', { class: 'muted small' }, p.address));

    // Hours
    const hoursBox = h('div');
    if (p.hours) {
      const todayKey = DAYS[parseISO(today()).getDay()];
      const tbl = h('table', { class: 'hours' },
        WEEK.filter(d => p.hours[d] !== undefined).map(d =>
          h('tr', { class: d === todayKey ? 'today' : '' }, h('td', null, DAY_LABEL[d]), h('td', null, fmtRanges(p.hours[d])))));
      hoursBox.append(h('div', { style: 'font-weight:600' }, 'Hours as of Sept 2026, check Google Maps'), tbl);
    } else {
      hoursBox.append(h('div', { style: 'font-weight:600' }, 'Hours: check Google Maps'));
    }
    body.appendChild(hoursBox);

    body.appendChild(h('a', { class: 'btn primary block', href: gmapsUrl(p), target: '_blank', rel: 'noopener' }, 'Open in Google Maps ↗'));

    const visited = !!S.visited[p.id];
    body.appendChild(h('div', { class: 'grid2' },
      h('button', {
        type: 'button', class: 'btn' + (visited ? ' on' : ''), 'aria-pressed': String(visited),
        onclick: () => { if (S.visited[p.id]) delete S.visited[p.id]; else S.visited[p.id] = true; save(); renderMarkers(); refreshSheet(); },
      }, visited ? '✓ Visited' : 'Mark visited'),
      h('button', { type: 'button', class: 'btn', onclick: () => show(() => addToItinForm(p.id, back)) }, '+ Day plan'),
    ));

    // Notes
    const curatedNotes = p.user ? '' : (p.notes || '');
    const ta = h('textarea', { class: 'input', id: 'notes', placeholder: 'Your notes (saved on this phone)' });
    ta.value = S.notes[p.id] != null ? S.notes[p.id] : (p.user ? (p.notes || '') : curatedNotes);
    let nt;
    ta.addEventListener('input', () => {
      clearTimeout(nt);
      nt = setTimeout(() => {
        if (p.user) { const u = S.userPlaces.find(x => x.id === p.id); if (u) u.notes = ta.value; }
        else S.notes[p.id] = ta.value;
        save(); saved.textContent = 'Saved';
      }, 350);
      saved.textContent = '…';
    });
    const saved = h('span', { class: 'muted small' });
    body.appendChild(h('label', { class: 'field', for: 'notes' }, h('span', null, 'Notes '), saved, ta));

    if (p.sources && p.sources.length) {
      body.appendChild(h('div', { class: 'sources' }, h('div', { style: 'font-weight:600' }, 'Sources'),
        p.sources.map(s => h('a', { href: s.url, target: '_blank', rel: 'noopener' }, (s.label || s.url) + ' ↗'))));
    }
    if (p.user && p.link) {
      body.appendChild(h('div', { class: 'sources' }, h('a', { href: p.link, target: '_blank', rel: 'noopener' }, 'Link ↗')));
    }

    const row = h('div', { class: 'grid2' });
    row.appendChild(h('button', {
      type: 'button', class: 'btn', onclick: () => fixLocation(p.id),
    }, hasLoc(p) ? '📍 Fix location' : '📍 Set location'));
    if (hasLoc(p)) row.appendChild(h('button', { type: 'button', class: 'btn', onclick: () => { closeSheet(); map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17)); } }, 'Show on map'));
    body.appendChild(row);
    if (p.fixed) body.appendChild(h('button', {
      type: 'button', class: 'btn small', onclick: () => { delete S.locOverrides[p.id]; save(); renderMarkers(); refreshSheet(); toast('Location reset to the curated one'); },
    }, 'Undo my location fix'));
    if (p.user) {
      body.appendChild(h('div', { class: 'grid2' },
        h('button', { type: 'button', class: 'btn', onclick: () => show(() => placeForm(p.id)) }, 'Edit'),
        h('button', {
          type: 'button', class: 'btn danger', onclick: () => {
            if (!confirm(`Delete “${p.name}”? This removes it from this phone.`)) return;
            S.userPlaces = S.userPlaces.filter(x => x.id !== p.id);
            delete S.visited[p.id]; delete S.notes[p.id];
            for (const it of Object.values(S.itineraries)) {
              it.stops = (it.stops || []).filter(s => !(s.type === 'place' && s.placeId === p.id));
              it.stops.forEach(s => { if (s.placeId === p.id) s.placeId = null; });
            }
            save(); renderMarkers(); renderRoute(); closeSheet(); toast('Deleted');
          },
        }, 'Delete'),
      ));
    }
    openSheet(p.name, body, back);
  }

  function fixLocation(id) {
    const p = byId(id);
    startPick(`Tap the map where “${p.name}” is`, ll => {
      if (p.user) { const u = S.userPlaces.find(x => x.id === id); u.lat = ll.lat; u.lng = ll.lng; }
      else S.locOverrides[id] = ll;
      save(); renderMarkers(); renderRoute();
      toast('Location saved');
      openPlace(id);
    });
    if (hasLoc(p)) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17));
  }

  // ------------------------------------------------------------------ add / edit place
  function placeForm(id, presetLoc) {
    const existing = id ? S.userPlaces.find(x => x.id === id) : null;
    const draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: null, name: '', category: 'food', tags: [], notes: '', link: '', lat: null, lng: null,
    };
    if (presetLoc) { draft.lat = presetLoc.lat; draft.lng = presetLoc.lng; }
    formWith(draft);

    function formWith(d) {
      if (hasLoc(d)) showPickMarker(d); else if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; }
      const name = h('input', { type: 'text', value: d.name, required: true, autocomplete: 'off', placeholder: 'e.g. Great dumpling shop' });
      const cat = h('select', null, Object.keys(CATS).filter(c => c !== 'home-base').map(c => h('option', { value: c, selected: d.category === c }, CATS[c].label)));
      const tagBoxes = TAGS.map(t => h('label', null, h('input', { type: 'checkbox', value: t, checked: d.tags.includes(t) }), TAG_LABEL[t]));
      const notes = h('textarea', { value: d.notes || '' }); notes.value = d.notes || '';
      const link = h('input', { type: 'url', value: d.link || '', placeholder: 'https://… (optional)', inputmode: 'url' });
      const locText = h('div', { class: hasLoc(d) ? 'muted small' : 'warn' }, hasLoc(d) ? `📍 ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : 'No location yet — use GPS or tap the map');
      const collect = () => {
        d.name = name.value.trim(); d.category = cat.value; d.notes = notes.value; d.link = link.value.trim();
        d.tags = tagBoxes.map(l => l.firstChild).filter(i => i.checked).map(i => i.value);
      };
      const body = h('form', {
        class: 'stack', onsubmit: e => {
          e.preventDefault(); collect();
          if (!d.name) { toast('Give it a name'); name.focus(); return; }
          if (!hasLoc(d)) { toast('Set a location first'); return; }
          if (d.link && !/^https?:\/\//i.test(d.link)) d.link = 'https://' + d.link;
          d.city = nearestCity(d);
          if (existing) Object.assign(existing, d);
          else { d.id = 'u-' + Date.now().toString(36); S.userPlaces.push(d); }
          save(); if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; }
          renderMarkers(); renderRoute(); toast(existing ? 'Saved' : 'Place added');
          openPlace(d.id);
        },
      },
      h('label', { class: 'field' }, 'Name', name),
      h('label', { class: 'field' }, 'Category', cat),
      h('div', null, h('div', { style: 'font-weight:600;font-size:14px' }, 'Tags'), h('div', { class: 'checks' }, tagBoxes)),
      h('div', null, h('div', { style: 'font-weight:600;font-size:14px' }, 'Location'), locText),
      h('div', { class: 'grid2' },
        h('button', {
          type: 'button', class: 'btn', onclick: () => {
            collect();
            getPosition(pos => { d.lat = +pos.lat.toFixed(6); d.lng = +pos.lng.toFixed(6); map.setView([d.lat, d.lng], 17); formWith(d); });
          },
        }, '◎ Use my GPS'),
        h('button', {
          type: 'button', class: 'btn', onclick: () => {
            collect();
            startPick('Tap the map to place the pin', ll => { d.lat = ll.lat; d.lng = ll.lng; show(() => formWith(d)); });
          },
        }, '👆 Tap the map'),
      ),
      h('div', { class: 'muted small' }, 'Tip: long-press anywhere on the map to start a new place there.'),
      h('label', { class: 'field' }, 'Notes', notes),
      h('label', { class: 'field' }, 'Link', link),
      h('button', { type: 'submit', class: 'btn primary block' }, existing ? 'Save changes' : 'Add place'),
      );
      currentSheet = () => { collect(); formWith(d); };
      openSheet(existing ? 'Edit place' : 'Add a place', body, existing ? () => openPlace(existing.id) : null);
    }
  }
  function nearestCity(ll) {
    const tc = byId(HOME_ID);
    const tp = { lat: 25.04, lng: 121.53 }; // only used to label a user-added place Taichung vs Taipei
    return distM(ll, tc) < distM(ll, tp) ? 'Taichung' : 'Taipei';
  }

  // ------------------------------------------------------------------ geolocation
  let watchId = null, follow = false, locateWaiters = [];
  function drawMe() {
    meLayer.clearLayers();
    if (!myPos) return;
    L.circle([myPos.lat, myPos.lng], { radius: Math.min(myPos.acc || 0, 300), color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }).addTo(meLayer);
    L.marker([myPos.lat, myPos.lng], { icon: L.divIcon({ className: 'me-dot', html: '<div></div>', iconSize: [24, 24], iconAnchor: [12, 12] }), interactive: false, zIndexOffset: 2000 }).addTo(meLayer);
  }
  function startWatch() {
    if (!('geolocation' in navigator)) { toast('Location is not available in this browser'); return false; }
    if (watchId != null) return true;
    watchId = navigator.geolocation.watchPosition(pos => {
      myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      drawMe(); $('#btnLocate').classList.add('active');
      if (follow) { map.setView([myPos.lat, myPos.lng], Math.max(map.getZoom(), 16)); follow = false; }
      const w = locateWaiters; locateWaiters = []; w.forEach(f => f(myPos));
    }, err => {
      const msg = err.code === 1 ? 'Location permission denied — allow it in your browser settings' : 'Could not get your location';
      toast(msg); follow = false; locateWaiters = [];
      if (err.code === 1) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    return true;
  }
  function getPosition(cb) {
    if (myPos) { cb(myPos); return; }
    if (startWatch()) { locateWaiters.push(cb); toast('Finding you…'); }
  }
  $('#btnLocate').addEventListener('click', () => {
    if (myPos) { map.setView([myPos.lat, myPos.lng], Math.max(map.getZoom(), 16)); return; }
    follow = true; if (startWatch()) toast('Finding you…');
  });

  // ------------------------------------------------------------------ itinerary
  function itin(date) {
    if (!S.itineraries[date]) S.itineraries[date] = { start: HOME_ID, stops: [] };
    const it = S.itineraries[date];
    if (!Array.isArray(it.stops)) it.stops = [];
    return it;
  }
  function itinDate() {
    let d = S.settings.itinDate;
    if (!d || d < TRIP_START || d > TRIP_END) {
      const t = today();
      d = (t >= TRIP_START && t <= TRIP_END) ? t : TRIP_START;
    }
    return d;
  }
  function stopPlace(s) { return s.placeId ? byId(s.placeId) : null; }
  function stopLoc(s) { const p = stopPlace(s); return hasLoc(p) ? { lat: p.lat, lng: p.lng } : null; }
  function stopTitle(s) {
    if (s.type === 'custom') return s.title || 'Untitled';
    const p = stopPlace(s); return p ? p.name : '(deleted place)';
  }
  function startLoc(it) {
    if (it.start === 'me') return myPos ? { lat: myPos.lat, lng: myPos.lng } : null;
    const p = byId(it.start); return hasLoc(p) ? { lat: p.lat, lng: p.lng } : null;
  }
  function startLabel(it) {
    if (it.start === 'me') return 'My location';
    const p = byId(it.start); return p ? p.name : 'Home base';
  }
  function newStopId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

  function suggestOrder(it) {
    let cur = startLoc(it);
    if (!cur) { toast(it.start === 'me' ? 'Turn on location first (◎), or pick a different start' : 'Start has no location'); return; }
    const withLoc = it.stops.filter(s => stopLoc(s));
    const without = it.stops.filter(s => !stopLoc(s));
    const out = [];
    while (withLoc.length) {
      let bi = 0, bd = Infinity;
      withLoc.forEach((s, i) => { const d = distM(cur, stopLoc(s)); if (d < bd) { bd = d; bi = i; } });
      const [s] = withLoc.splice(bi, 1); out.push(s); cur = stopLoc(s);
    }
    it.stops = out.concat(without);
    save(); renderRoute();
    toast(without.length ? 'Reordered. Stops without a location were moved to the end.' : 'Reordered by nearest next stop');
  }

  function openItinerary() { show(itineraryView); }

  function itineraryView() {
    const date = itinDate();
    S.settings.itinDate = date;
    const it = itin(date);
    const body = h('div', { class: 'stack' });

    const dateSel = h('select', {
      onchange: e => { S.settings.itinDate = e.target.value; save(); renderRoute(); itineraryView(); },
    }, tripDates().map(d => h('option', { value: d, selected: d === date }, fmtDate(d) + (S.itineraries[d] && S.itineraries[d].stops.length ? ` · ${S.itineraries[d].stops.length} stops` : ''))));
    const homes = allPlaces().filter(p => p.category === 'home-base');
    const startSel = h('select', {
      onchange: e => { it.start = e.target.value; save(); renderRoute(); itineraryView(); },
    }, homes.map(p => h('option', { value: p.id, selected: it.start === p.id }, p.name)), h('option', { value: 'me', selected: it.start === 'me' }, 'My current location'));
    body.appendChild(h('div', { class: 'grid2' }, h('label', { class: 'field' }, 'Date', dateSel), h('label', { class: 'field' }, 'Start from', startSel)));
    if (date >= LONG_WEEKEND[0] && date <= LONG_WEEKEND[1]) body.appendChild(h('div', { class: 'flag' }, 'National Day long weekend — expect crowds.'));
    if (it.start === 'me' && !myPos) body.appendChild(h('div', { class: 'warn' }, 'Tap ◎ to turn on location, or distances from the start will be missing.'));

    // stops
    const list = h('div');
    let prev = startLoc(it);
    list.appendChild(h('div', { class: 'muted small' }, '🏠 Start: ' + startLabel(it)));
    it.stops.forEach((s, i) => {
      const loc = stopLoc(s);
      list.appendChild(legEl(prev, loc, i === 0 ? 'start' : null));
      if (loc) prev = loc;
      list.appendChild(stopEl(it, s, i, date));
    });
    if (!it.stops.length) list.appendChild(h('p', { class: 'muted' }, 'No stops yet. Add places from the map (+ Day plan on a place card) or below.'));
    body.appendChild(list);

    body.appendChild(h('div', { class: 'grid2' },
      h('button', { type: 'button', class: 'btn', onclick: () => show(() => addStopPicker(date)) }, '+ Add place'),
      h('button', { type: 'button', class: 'btn', onclick: () => show(() => customForm(date, null)) }, '+ Custom entry'),
    ));
    body.appendChild(h('button', {
      type: 'button', class: 'btn block', disabled: it.stops.length < 2 ? true : null,
      onclick: () => { suggestOrder(it); itineraryView(); },
    }, '🚶 Suggest walking order (from ' + (it.start === 'me' ? 'my location' : 'start') + ')'));
    body.appendChild(h('label', { class: 'row', style: 'gap:10px;font-weight:600' },
      h('input', { type: 'checkbox', checked: S.settings.showRoute, style: 'width:22px;height:22px', onchange: e => { S.settings.showRoute = e.target.checked; save(); renderRoute(); } }),
      'Show this day’s route on the map'));
    body.appendChild(h('button', { type: 'button', class: 'btn block', onclick: () => { closeSheet(); fitRoute(); } }, 'View route on map'));
    body.appendChild(h('div', { class: 'muted small' },
      `Distances are straight lines; walking times assume about ${WALK_M_PER_MIN} m per minute. Both are estimates.`));

    // nearby ideas
    body.appendChild(h('hr'));
    body.appendChild(nearbySection(it, date));

    openSheet('Day plan', body);
  }

  function legEl(a, b, kind) {
    if (!b) return h('div', { class: 'leg' }, '↓ distance unknown (no location)');
    if (!a) return h('div', { class: 'leg' }, kind === 'start' ? '↓ start location unknown' : '↓');
    const d = distM(a, b);
    const far = d > FAR_M;
    return h('div', { class: 'leg' + (far ? ' far' : '') },
      `↓ ${fmtDist(d)} · ~${walkMin(d)} min walk (est.)` + (far ? ' · probably not walkable' : ''));
  }

  function stopEl(it, s, i, date) {
    const p = stopPlace(s);
    const warns = [];
    if (p && p.flag) warns.push(h('div', { class: 'warn' }, '⚠️ ' + p.flag));
    const hs = p ? hoursStatus(p, date, s.time) : null;
    if (hs) warns.push(h('div', { class: 'bad' }, '⏰ ' + hs.msg));
    if (p && p.category === 'event' && !eventActive(p, date)) warns.push(h('div', { class: 'bad' }, `📅 This event isn't on ${fmtDate(date)} (${fmtDate(p.startDate)} – ${fmtDate(p.endDate)})`));
    if (s.placeId && !hasLoc(p)) warns.push(h('div', { class: 'warn' }, 'This place needs a location'));
    const move = (delta) => {
      const j = i + delta; if (j < 0 || j >= it.stops.length) return;
      const [x] = it.stops.splice(i, 1); it.stops.splice(j, 0, x); save(); renderRoute(); itineraryView();
    };
    const time = h('input', {
      type: 'time', class: 'input time', value: s.time || '', 'aria-label': 'Planned time',
      onchange: e => { s.time = e.target.value || null; save(); itineraryView(); },
    });
    return h('div', { class: 'stop' },
      h('div', { class: 'li-main' },
        h('div', { class: 'stop-num' }, String(i + 1)),
        h('div', { class: 'grow' },
          h('button', {
            type: 'button', class: 'pick-item li-title', onclick: () => {
              if (p) openPlace(p.id, openItinerary);
              else show(() => customForm(date, s.id));
            },
          }, (s.type === 'custom' ? '🗓️ ' : '') + stopTitle(s)),
          s.type === 'custom' && p ? h('div', { class: 'muted small' }, '@ ' + p.name) : null,
        ),
      ),
      h('div', { class: 'row', style: 'margin-top:8px;justify-content:space-between' },
        time,
        h('div', { class: 'stop-btns' },
          h('button', { type: 'button', class: 'btn small', 'aria-label': 'Move up', disabled: i === 0 ? true : null, onclick: () => move(-1) }, '↑'),
          h('button', { type: 'button', class: 'btn small', 'aria-label': 'Move down', disabled: i === it.stops.length - 1 ? true : null, onclick: () => move(1) }, '↓'),
          h('button', {
            type: 'button', class: 'btn small danger', 'aria-label': 'Remove stop',
            onclick: () => { it.stops.splice(i, 1); save(); renderRoute(); itineraryView(); },
          }, '✕'),
        ),
      ),
      warns.length ? h('div', { class: 'stack', style: 'margin-top:8px' }, warns) : null,
    );
  }

  function addStopPicker(date) {
    const it = itin(date);
    const body = h('div', { class: 'stack' });
    const q = h('input', { type: 'search', class: 'input', placeholder: 'Filter by name, category or tag', autocomplete: 'off' });
    const list = h('ul', { class: 'list' });
    const draw = () => {
      const term = q.value.trim().toLowerCase();
      list.textContent = '';
      // Alphabetical within each city (never sorted by distance).
      const items = allPlaces()
        .filter(p => p.category !== 'home-base')
        .filter(p => !term || [p.name, p.category, (p.tags || []).join(' '), p.district || '', p.city || ''].join(' ').toLowerCase().includes(term))
        .sort((a, b) => (a.city === S.settings.city ? 0 : 1) - (b.city === S.settings.city ? 0 : 1) || a.name.localeCompare(b.name));
      for (const p of items) {
        const already = it.stops.some(s => s.placeId === p.id && s.type === 'place');
        list.appendChild(h('li', null, h('div', { class: 'li-main' },
          h('div', { class: 'grow' }, h('div', { class: 'li-title' }, p.name), h('div', { class: 'muted small' }, [CATS[p.category].label, p.city, hasLoc(p) ? null : 'needs location'].filter(Boolean).join(' · '))),
          h('button', {
            type: 'button', class: 'btn small' + (already ? '' : ' primary'),
            onclick: () => { it.stops.push({ id: newStopId(), type: 'place', placeId: p.id, time: null }); save(); renderRoute(); toast(`Added to ${fmtDate(date)}`); draw(); },
          }, already ? 'Add again' : 'Add'),
        )));
      }
    };
    q.addEventListener('input', draw);
    body.append(q, list); draw();
    openSheet('Add a stop · ' + fmtDate(date), body, openItinerary);
  }

  function customForm(date, stopId) {
    const it = itin(date);
    const s = stopId ? it.stops.find(x => x.id === stopId) : null;
    const title = h('input', { type: 'text', value: s ? s.title : '', placeholder: 'e.g. Lunch with family' });
    const time = h('input', { type: 'time', value: s ? (s.time || '') : '' });
    const opts = allPlaces().slice().sort((a, b) => a.name.localeCompare(b.name));
    const place = h('select', null, h('option', { value: '' }, '— none —'), opts.map(p => h('option', { value: p.id, selected: s && s.placeId === p.id }, p.name)));
    const body = h('form', {
      class: 'stack', onsubmit: e => {
        e.preventDefault();
        if (!title.value.trim()) { toast('Add a title'); return; }
        const data = { title: title.value.trim(), time: time.value || null, placeId: place.value || null };
        if (s) Object.assign(s, data); else it.stops.push(Object.assign({ id: newStopId(), type: 'custom' }, data));
        save(); renderRoute(); openItinerary();
      },
    },
    h('label', { class: 'field' }, 'Title', title),
    h('label', { class: 'field' }, 'Time', time),
    h('label', { class: 'field' }, 'Place (optional)', place),
    h('button', { type: 'submit', class: 'btn primary block' }, s ? 'Save' : 'Add entry'),
    s ? h('button', { type: 'button', class: 'btn danger block', onclick: () => { it.stops = it.stops.filter(x => x !== s); save(); renderRoute(); openItinerary(); } }, 'Remove entry') : null,
    );
    openSheet((s ? 'Edit entry · ' : 'Custom entry · ') + fmtDate(date), body, openItinerary);
  }

  function addToItinForm(placeId, back) {
    const p = byId(placeId);
    const dateSel = h('select', null, tripDates().map(d => h('option', { value: d, selected: d === itinDate() }, fmtDate(d))));
    const time = h('input', { type: 'time' });
    const status = h('div');
    const check = () => {
      status.textContent = '';
      const hs = hoursStatus(p, dateSel.value, time.value || null);
      if (hs) status.appendChild(h('div', { class: 'bad' }, '⏰ ' + hs.msg + ' — you can still add it.'));
      if (p.category === 'event' && !eventActive(p, dateSel.value)) status.appendChild(h('div', { class: 'bad' }, "📅 This event isn't on that date."));
    };
    dateSel.addEventListener('change', check); time.addEventListener('change', check);
    const body = h('form', {
      class: 'stack', onsubmit: e => {
        e.preventDefault();
        const it = itin(dateSel.value);
        it.stops.push({ id: newStopId(), type: 'place', placeId, time: time.value || null });
        S.settings.itinDate = dateSel.value; save(); renderRoute();
        toast(`Added to ${fmtDate(dateSel.value)} as stop ${it.stops.length}`);
        openPlace(placeId, back);
      },
    },
    h('label', { class: 'field' }, 'Date', dateSel),
    h('label', { class: 'field' }, 'Time (optional)', time),
    status,
    h('button', { type: 'submit', class: 'btn primary block' }, 'Add to day plan'),
    );
    check();
    openSheet('Add “' + p.name + '”', body, () => openPlace(placeId, back));
  }

  function nearbySection(it, date) {
    const wrap = h('div', { class: 'stack' });
    wrap.appendChild(h('h3', null, 'Nearby ideas (within ~1 km)'));
    const opts = [['center', 'Map center']];
    if (myPos) opts.push(['me', 'My location']);
    it.stops.forEach((s, i) => { if (stopLoc(s)) opts.push(['stop' + i, `Stop ${i + 1}: ${stopTitle(s)}`]); });
    const key = nearbySection.key && opts.some(o => o[0] === nearbySection.key) ? nearbySection.key : 'center';
    const sel = h('select', { class: 'input', onchange: e => { nearbySection.key = e.target.value; itineraryView(); } },
      opts.map(([v, l]) => h('option', { value: v, selected: v === key }, 'Near: ' + l)));
    wrap.appendChild(sel);
    let origin;
    if (key === 'me') origin = myPos;
    else if (key.startsWith('stop')) origin = stopLoc(it.stops[+key.slice(4)]);
    else { const c = map.getCenter(); origin = { lat: c.lat, lng: c.lng }; }
    const inPlan = new Set(it.stops.map(s => s.placeId));
    // Grouped by category, alphabetical — deliberately not sorted by distance.
    const near = allPlaces().filter(p => hasLoc(p) && p.category !== 'home-base' && !inPlan.has(p.id)
      && (p.category !== 'event' || eventActive(p, date)) && distM(origin, p) <= NEARBY_M)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    if (!near.length) { wrap.appendChild(h('p', { class: 'muted' }, 'Nothing on the list within about 1 km.')); return wrap; }
    const ul = h('ul', { class: 'list' });
    for (const p of near) {
      const d = distM(origin, p);
      const hs = hoursStatus(p, date, null);
      ul.appendChild(h('li', null, h('div', { class: 'li-main' },
        h('div', { class: 'grow' },
          h('button', { type: 'button', class: 'pick-item li-title', onclick: () => openPlace(p.id, openItinerary) }, (S.visited[p.id] ? '✓ ' : '') + p.name),
          h('div', { class: 'muted small' }, `${CATS[p.category].label} · ${fmtDist(d)} · ~${walkMin(d)} min` + (hs ? ' · ' + hs.msg : ''))),
        h('button', {
          type: 'button', class: 'btn small primary',
          onclick: () => { it.stops.push({ id: newStopId(), type: 'place', placeId: p.id, time: null }); save(); renderRoute(); toast('Added'); itineraryView(); },
        }, 'Add'),
      )));
    }
    wrap.appendChild(ul);
    return wrap;
  }

  function routePoints() {
    const it = S.itineraries[itinDate()];
    if (!it) return [];
    const pts = [];
    const st = startLoc(it); if (st) pts.push({ ll: st, n: 0 });
    it.stops.forEach((s, i) => { const l = stopLoc(s); if (l) pts.push({ ll: l, n: i + 1, s }); });
    return pts;
  }
  function renderRoute() {
    routeLayer.clearLayers();
    if (!S.settings.showRoute) return;
    const pts = routePoints();
    if (pts.filter(p => p.n > 0).length === 0) return;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1].ll, b = pts[i].ll;
      const far = distM(a, b) > FAR_M;
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: far ? '#dc2626' : '#0f766e', weight: 6, opacity: .85, dashArray: far ? '10 10' : null, lineCap: 'round', interactive: false }).addTo(routeLayer);
    }
    pts.filter(p => p.n > 0).forEach(p => {
      L.marker([p.ll.lat, p.ll.lng], {
        icon: L.divIcon({ className: 'rt', html: `<div>${p.n}</div>`, iconSize: [26, 26], iconAnchor: [13, 34] }),
        zIndexOffset: 1500, title: `Stop ${p.n}: ${stopTitle(p.s)}`,
      }).on('click', () => { if (!pick) openItinerary(); }).addTo(routeLayer);
    });
  }
  function fitRoute() {
    const pts = routePoints();
    if (!pts.length) { toast('No stops with a location yet'); return; }
    if (!S.settings.showRoute) { S.settings.showRoute = true; save(); renderRoute(); }
    map.fitBounds(L.latLngBounds(pts.map(p => [p.ll.lat, p.ll.lng])), { paddingTopLeft: [40, 110], paddingBottomRight: [70, 170], maxZoom: 17 });
  }

  // ------------------------------------------------------------------ menu, date, backup
  function openMenu() { show(menuView); }
  function menuView() {
    const need = needsLocation();
    const body = h('div', { class: 'stack' });
    body.appendChild(h('h3', null, `Needs location (${need.length})`));
    if (!need.length) body.appendChild(h('p', { class: 'muted' }, 'Every place has a location. 🎉'));
    else {
      body.appendChild(h('p', { class: 'muted small' }, 'These couldn’t be placed automatically. Open one, then use “Set location” and tap the map. Tip: “Open in Google Maps” shows where it is.'));
      body.appendChild(h('ul', { class: 'list' }, need.map(p => h('li', null, h('div', { class: 'li-main' },
        h('div', { class: 'grow' }, h('button', { type: 'button', class: 'pick-item li-title', onclick: () => openPlace(p.id, openMenu) }, p.name),
          h('div', { class: 'muted small' }, [CATS[p.category].label, p.district, p.city].filter(Boolean).join(' · '))),
        h('a', { class: 'btn small', href: gmapsUrl(p), target: '_blank', rel: 'noopener' }, 'Maps ↗'),
        h('button', { type: 'button', class: 'btn small primary', onclick: () => fixLocation(p.id) }, 'Set'),
      )))));
    }

    body.appendChild(h('h3', null, 'Backup'));
    body.appendChild(h('p', { class: 'muted small' },
      'Your visited marks, notes, added places, location fixes and day plans are saved only in this browser on this phone. Clearing browser data or switching phones loses them — export a backup now and then.'));
    body.appendChild(h('div', { class: 'grid2' },
      h('button', { type: 'button', class: 'btn primary', onclick: exportData }, '⬇ Export my data'),
      h('button', { type: 'button', class: 'btn', onclick: () => $('#importFile').click() }, '⬆ Import'),
    ));
    const counts = `${Object.keys(S.visited).length} visited · ${Object.values(S.notes).filter(Boolean).length} notes · ${S.userPlaces.length} added · ${Object.values(S.itineraries).reduce((n, it) => n + (it.stops || []).length, 0)} plan stops`;
    body.appendChild(h('div', { class: 'muted small' }, counts));

    body.appendChild(h('h3', null, 'Date for events'));
    body.appendChild(dateControls());

    body.appendChild(h('h3', null, 'About'));
    body.appendChild(h('p', { class: 'muted small' },
      `${curated.length} curated places. Map data © OpenStreetMap contributors. Hours are a snapshot as of Sept 2026 — always check Google Maps. Walking times are straight-line estimates.`));
    body.appendChild(h('p', { class: 'small' },
      h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap licence ↗'), ' · ',
      h('a', { href: 'https://www.openstreetmap.org/fixthemap', target: '_blank', rel: 'noopener' }, 'Report a map issue ↗')));
    openSheet('More', body);
  }

  function dateControls() {
    const inp = h('input', { type: 'date', class: 'input', value: today() });
    return h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'Events show on the map only on their dates. Pick another date to plan ahead.'),
      inp,
      h('div', { class: 'grid2' },
        h('button', {
          type: 'button', class: 'btn primary', onclick: () => {
            if (!inp.value) return;
            S.settings.todayOverride = inp.value === realToday() ? null : inp.value; save();
            renderTop(); renderMarkers(); refreshSheet(); toast('Showing events for ' + fmtDate(today()));
          },
        }, 'Use this date'),
        h('button', {
          type: 'button', class: 'btn', onclick: () => { S.settings.todayOverride = null; save(); renderTop(); renderMarkers(); refreshSheet(); toast('Back to the real date'); },
        }, 'Real today'),
      ));
  }
  function openDateSheet() { show(() => openSheet('Date', dateControls())); }

  function exportData() {
    const payload = { app: 'taiwan-map', version: 1, exportedAt: new Date().toISOString(), data: S };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `taiwan-map-backup-${realToday()}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Backup downloaded');
  }
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const data = obj && obj.app === 'taiwan-map' ? obj.data : null;
      if (!data || typeof data !== 'object') throw new Error('not a Taiwan Map backup');
      if (!confirm('Replace the data on this phone with this backup?')) return;
      S = mergeState(data); save();
      renderAll(); refreshSheet(); toast('Backup restored');
    } catch (err) { toast('Import failed: ' + err.message); }
  });

  // ------------------------------------------------------------------ wiring
  function renderAll() { renderTop(); renderFilters(); renderMarkers(); renderRoute(); }
  document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => goCity(b.dataset.city, true)));
  $('#datePill').addEventListener('click', openDateSheet);
  $('#btnItin').addEventListener('click', openItinerary);
  $('#btnAdd').addEventListener('click', () => show(() => placeForm(null)));
  $('#btnMenu').addEventListener('click', openMenu);
  $('#sheetClose').addEventListener('click', () => { closeSheet(); if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; } });
  $('#sheetBack').addEventListener('click', () => { const f = sheetBackFn; if (f) f(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (pick) { endPick(); } else closeSheet(); } });

  fetch('places.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(data => {
      curated = data;
      renderAll();
      if (S.settings.city === 'Taipei') goCity('Taipei', false);
      else { const home = byId(HOME_ID); map.setView([home.lat, home.lng], 15); }
      // Start the location dot if permission was already granted (no prompt otherwise).
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(r => { if (r.state === 'granted') startWatch(); }).catch(() => {});
      }
    })
    .catch(err => { toast('Could not load places.json (' + err.message + ')'); });

  // Exposed for debugging in the console only.
  window.twmap = { get state() { return S; }, map, cluster, homeLayer, routeLayer, allPlaces, hoursStatus, isShown };
})();
