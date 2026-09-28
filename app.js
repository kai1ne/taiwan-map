/* Taiwan Map — plain JS, no build step.
 * Curated places come from places.json; everything the user changes lives in
 * localStorage under STORE_KEY. No paid APIs, no keys. */
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
  const SLOT_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // JS getDay() order
  const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_LABEL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
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
      visited: {}, notes: {}, userPlaces: [], locOverrides: {}, itineraries: {},
      settings: {
        cats: { 'food': true, 'shopping': true, 'film-lab': true, 'attraction': true, 'event': true },
        tags: { 'michelin': false, 'kid-friendly': false },
        allEvents: false, todayOverride: null, itinDate: null, showRoute: true, city: 'Taichung', panel: 'peek',
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
    try { return mergeState(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch (e) { return defaultState(); }
  }
  let S = loadState();
  let storageOk = true;
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); storageOk = true; }
    catch (e) { if (storageOk) toast('Could not save on this phone (storage blocked?)'); storageOk = false; }
  }

  let curated = [];
  let myPos = null;   // {lat, lng, acc}
  let pick = null;    // map-tap mode {text, onPick}
  let searchText = '';
  let nearKey = 'off';

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
  function pad(n) { return String(n).padStart(2, '0'); }
  function isoLocal(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function realToday() { return isoLocal(new Date()); }
  function today() { return S.settings.todayOverride || realToday(); }
  function fmtDate(s, opts) { return parseISO(s).toLocaleDateString('en-US', Object.assign({ weekday: 'short', month: 'short', day: 'numeric' }, opts || {})); }
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
  const wide = window.matchMedia('(min-width: 800px)');

  // ------------------------------------------------------------------ places
  function allPlaces() {
    const cur = curated.map(p => {
      const o = S.locOverrides[p.id];
      return o ? Object.assign({}, p, { lat: o.lat, lng: o.lng, fixed: true }) : p;
    });
    return cur.concat(S.userPlaces.map(p => Object.assign({}, p, { user: true })));
  }
  function byId(id) { return allPlaces().find(p => p.id === id); }
  function hasLoc(p) { return !!p && typeof p.lat === 'number' && typeof p.lng === 'number'; }
  function needsLocation() { return allPlaces().filter(p => !hasLoc(p)); }
  function gmapsUrl(p) {
    if (p.gmaps) return p.gmaps;
    if (p.user && hasLoc(p)) return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${p.name} ${p.city || ''}`.trim());
  }
  // Keyless Google Maps directions link; with no origin, Google starts from the phone's location.
  function walkUrl(dest, origin) {
    const d = hasLoc(dest) ? `${dest.lat},${dest.lng}` : encodeURIComponent(`${dest.name} ${dest.city || ''}`.trim());
    const o = origin ? `&origin=${origin.lat},${origin.lng}` : '';
    return `https://www.google.com/maps/dir/?api=1${o}&destination=${d}&travelmode=walking`;
  }
  function eventActive(p, day) { return !!(p.startDate && p.endDate && day >= p.startDate && day <= p.endDate); }

  // Shared filter logic for the map, the Places list and the Day plan list.
  function passesFilters(p) {
    if (p.category === 'home-base') return true;
    if (!S.settings.cats[p.category]) return false;
    if (p.category === 'event' && !S.settings.allEvents && !eventActive(p, today())) return false;
    const tagOn = Object.keys(S.settings.tags).filter(t => S.settings.tags[t]);
    if (tagOn.length && !tagOn.some(t => (p.tags || []).includes(t))) return false;
    return true;
  }
  function isShown(p) { return hasLoc(p) && passesFilters(p); }
  function matchesSearch(p) {
    const t = searchText.trim().toLowerCase();
    if (!t) return true;
    return [p.name, p.nameZh || '', CATS[p.category].label, (p.tags || []).join(' '), p.district || '', p.city || '', p.why || '']
      .join(' ').toLowerCase().includes(t);
  }
  // Alphabetical, current city first. Never sorted by distance.
  function sortPlaces(list) {
    return list.sort((a, b) => (a.city === S.settings.city ? 0 : 1) - (b.city === S.settings.city ? 0 : 1)
      || (a.category === 'home-base' ? 0 : 1) - (b.category === 'home-base' ? 0 : 1)
      || a.name.localeCompare(b.name));
  }

  // ------------------------------------------------------------------ hours
  // hours = {mon: [["11:00","14:00"]], ..., sun: []}; [] = closed; missing day = unknown.
  // An end earlier than the start ("17:00","02:00") runs past midnight.
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
    const open = todays.some(([s, e]) => { const a = toMin(s), b = toMin(e); return b > a ? (t >= a && t < b) : t >= a; })
      || carry.some(([, e]) => t < toMin(e));
    if (open) return null;
    if (todays.length === 0) return { closed: true, msg: `Closed on ${DAY_FULL[day]}s (hours snapshot)` };
    return { closed: true, msg: `May be closed at ${time} — ${DAY_LABEL[day]} hours: ${fmtRanges(todays)}` };
  }
  function fmtRanges(r) {
    if (!r || !r.length) return 'closed';
    return r.map(([s, e]) => `${s}–${e}${toMin(e) < toMin(s) ? ' (next day)' : ''}`).join(', ');
  }

  // ------------------------------------------------------------------ map
  const map = L.map('map', { zoomControl: true, attributionControl: false }).setView([24.135834, 120.664215], 15);
  L.control.attribution({ position: 'topright', prefix: '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  const cluster = L.markerClusterGroup({ maxClusterRadius: 28, spiderfyOnMaxZoom: true, showCoverageOnHover: false });
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
      m.on('click', () => { if (!pick) openPlace(p.id, true); });
      if (p.category === 'home-base') { m.setZIndexOffset(1000); homeLayer.addLayer(m); } else add.push(m);
    }
    cluster.addLayers(add);
    const n = needsLocation().length;
    const b = $('#needBadge'); b.hidden = n === 0; b.textContent = n;
  }

  // Keep a point centred in the part of the map the panel doesn't cover.
  function visibleOffset() {
    if (wide.matches) return L.point(-$('#panel').offsetWidth / 2, 0);
    return L.point(0, $('#panel').offsetHeight / 2);
  }
  function focusOn(ll, zoom) {
    const z = zoom || Math.max(map.getZoom(), 16);
    const pt = map.project(L.latLng(ll.lat, ll.lng), z).add(visibleOffset());
    map.setView(map.unproject(pt, z), z);
  }
  function fitPadding() {
    return wide.matches
      ? { paddingTopLeft: [$('#panel').offsetWidth + 40, 80], paddingBottomRight: [80, 40] }
      : { paddingTopLeft: [30, 80], paddingBottomRight: [80, $('#panel').offsetHeight + 30] };
  }

  // ------------------------------------------------------------------ top bar
  function renderTop() {
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b.dataset.city === S.settings.city));
    const pill = $('#datePill');
    const ov = !!S.settings.todayOverride;
    pill.textContent = (ov ? 'Planning: ' : 'Today: ') + fmtDate(today());
    pill.classList.toggle('override', ov);
    const t = today();
    $('#banner').hidden = !(t >= LONG_WEEKEND[0] && t <= LONG_WEEKEND[1]);
  }
  function goCity(city) {
    S.settings.city = city; save(); renderTop(); refresh();
    if (city === 'Taichung') { const home = byId(HOME_ID); focusOn(home, 15); }
    else {
      const pts = allPlaces().filter(p => p.city === 'Taipei' && hasLoc(p)).map(p => [p.lat, p.lng]);
      if (pts.length) map.fitBounds(L.latLngBounds(pts), Object.assign({ maxZoom: 15 }, fitPadding()));
    }
  }

  // ------------------------------------------------------------------ panel (bottom sheet / sidebar)
  const PANEL_SIZES = ['peek', 'half', 'full'];
  function panelPx(size) {
    const vh = window.innerHeight;
    if (size === 'peek') return 196;
    if (size === 'half') return Math.round(vh * 0.52);
    return Math.round(vh - 70);
  }
  function setPanel(size, keep) {
    if (!PANEL_SIZES.includes(size)) size = 'peek';
    $('#panel').dataset.size = size;
    if (!keep) { S.settings.panel = size; save(); }
    applyPanelHeight(wide.matches ? 0 : panelPx(size));
  }
  function applyPanelHeight(px) {
    document.documentElement.style.setProperty('--panel-h', px + 'px');
    $('#btnLocate').hidden = !wide.matches && px > window.innerHeight * 0.75;
  }
  function atLeast(size) {
    if (wide.matches) return;
    if (PANEL_SIZES.indexOf($('#panel').dataset.size) < PANEL_SIZES.indexOf(size)) setPanel(size);
  }
  (function gripDrag() {
    const grip = $('#grip'), panel = $('#panel');
    let startY = null, startH = 0, moved = false;
    grip.addEventListener('pointerdown', e => {
      startY = e.clientY; startH = panel.offsetHeight; moved = false;
      grip.setPointerCapture(e.pointerId); panel.classList.add('dragging');
    });
    grip.addEventListener('pointermove', e => {
      if (startY == null) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 4) moved = true;
      applyPanelHeight(Math.max(120, Math.min(window.innerHeight - 50, startH + dy)));
    });
    const end = () => {
      if (startY == null) return;
      panel.classList.remove('dragging');
      const cur = panel.offsetHeight;
      startY = null;
      if (!moved) { const i = PANEL_SIZES.indexOf(panel.dataset.size); setPanel(PANEL_SIZES[(i + 1) % PANEL_SIZES.length]); return; }
      let best = 'peek', bd = Infinity;
      for (const s of PANEL_SIZES) { const d = Math.abs(panelPx(s) - cur); if (d < bd) { bd = d; best = s; } }
      setPanel(best);
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const i = PANEL_SIZES.indexOf(panel.dataset.size); setPanel(PANEL_SIZES[(i + 1) % 3]); } });
  })();
  window.addEventListener('resize', () => setPanel($('#panel').dataset.size, true));
  wide.addEventListener('change', () => setPanel($('#panel').dataset.size, true));

  // Views return {title, node, fill?, tab}. `view.back` is the view to return to.
  let view = { name: 'places', args: {}, back: null };
  const scrollMemo = {};
  function viewKey(v) { return v.name + ':' + ((v.args && (v.args.id || v.args.date)) || ''); }
  function saveScroll() {
    const b = $('#panelBody');
    const memo = { body: b.scrollTop };
    b.querySelectorAll('[data-scroll]').forEach(el => { memo[el.dataset.scroll] = el.scrollTop; });
    scrollMemo[viewKey(view)] = memo;
  }
  function restoreScroll() {
    const memo = scrollMemo[viewKey(view)];
    const b = $('#panelBody');
    if (!memo) { b.scrollTop = 0; return; }
    b.scrollTop = memo.body || 0;
    b.querySelectorAll('[data-scroll]').forEach(el => { if (memo[el.dataset.scroll] != null) el.scrollTop = memo[el.dataset.scroll]; });
  }
  function go(name, args, opts) {
    opts = opts || {};
    saveScroll();
    const prev = view;
    view = { name, args: args || {}, back: opts.back === undefined ? null : opts.back };
    if (opts.fromCurrent) view.back = prev;
    render();
  }
  function render() {
    const out = VIEWS[view.name](view.args || {});
    $('#panelTitle').textContent = out.title;
    $('#panelBack').hidden = !view.back;
    const body = $('#panelBody');
    body.className = out.fill ? 'fill' : '';
    body.replaceChildren(out.node);
    const tab = out.tab || view.name;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
    restoreScroll();
  }
  function refresh() { saveScroll(); render(); }
  function goBack() { if (!view.back) return; saveScroll(); view = view.back; render(); }

  // ------------------------------------------------------------------ filter UI (shared by map, Places and Day plan)
  function filterChips(onChange) {
    const wrap = h('div', { class: 'filters', role: 'toolbar', 'aria-label': 'Filters' });
    const changed = () => { save(); renderMarkers(); onChange(); };
    for (const c of FILTER_CATS) {
      wrap.appendChild(h('button', {
        type: 'button', class: 'chip' + (S.settings.cats[c] ? ' on' : ''), style: `--chip:${CATS[c].color}`, 'aria-pressed': String(!!S.settings.cats[c]),
        onclick: () => { S.settings.cats[c] = !S.settings.cats[c]; changed(); },
      }, h('span', { class: 'dot' }), CATS[c].label));
    }
    [['michelin', '★ Michelin'], ['kid-friendly', 'Kid-friendly']].forEach(([t, label]) => {
      wrap.appendChild(h('button', {
        type: 'button', class: 'chip' + (S.settings.tags[t] ? ' on' : ''), 'aria-pressed': String(!!S.settings.tags[t]),
        onclick: () => { S.settings.tags[t] = !S.settings.tags[t]; changed(); },
      }, label));
    });
    wrap.appendChild(h('button', {
      type: 'button', class: 'chip' + (S.settings.allEvents ? ' on' : ''), style: '--chip:var(--c-event)', 'aria-pressed': String(!!S.settings.allEvents),
      onclick: () => { S.settings.allEvents = !S.settings.allEvents; changed(); toast(S.settings.allEvents ? 'Showing all events, any date' : 'Showing only events on ' + fmtDate(today())); },
    }, 'All events'));
    return wrap;
  }
  function searchBox(onInput) {
    const inp = h('input', { type: 'search', class: 'input search', placeholder: 'Search name, 中文, tag, district…', value: searchText, autocomplete: 'off', 'aria-label': 'Search places' });
    inp.addEventListener('input', () => { searchText = inp.value; onInput(); });
    return inp;
  }
  function placeRow(p, o) {
    o = o || {};
    const c = CATS[p.category] || CATS.food;
    const bits = [c.label, p.district, p.city !== S.settings.city ? p.city : null,
      (p.tags || []).map(t => TAG_LABEL[t] || t).join(', ') || null,
      p.startDate ? `${fmtDate(p.startDate, { weekday: undefined })}–${fmtDate(p.endDate, { weekday: undefined })}` : null,
      hasLoc(p) ? null : '📍 needs location'].filter(Boolean);
    const dist = myPos && hasLoc(p) ? fmtDist(distM(myPos, p)) : null;
    return h('div', { class: 'prow' },
      o.handle ? h('button', {
        type: 'button', class: 'handle', 'aria-label': `Drag ${p.name} into a time`, title: 'Drag into a time',
        onpointerdown: e => startDrag(e, { type: 'place', placeId: p.id }, p.name),
      }, '⠿') : null,
      h('button', { type: 'button', class: 'main', onclick: () => o.onTap ? o.onTap(p) : openPlace(p.id) },
        h('span', { class: 'glyph' + (S.visited[p.id] ? ' visited' : ''), style: `--c:${c.color}` }, c.glyph),
        h('span', { class: 'txt' },
          h('div', { class: 'name' }, (S.visited[p.id] ? '✓ ' : '') + p.name),
          h('div', { class: 'sub' }, bits.join(' · ') + (o.extra ? ' · ' + o.extra : '')))),
      o.right || (dist ? h('span', { class: 'dist' }, dist) : null),
    );
  }
  function listWithGroups(items, rowFn) {
    const frag = h('div');
    let lastCity = null, ul = null;
    for (const p of items) {
      if (p.city !== lastCity) {
        lastCity = p.city;
        frag.appendChild(h('div', { class: 'group-h' }, p.city || 'Other'));
        ul = h('ul', { class: 'plist' }); frag.appendChild(ul);
      }
      ul.appendChild(h('li', null, rowFn(p)));
    }
    if (!items.length) frag.appendChild(h('p', { class: 'muted' }, 'Nothing matches these filters.'));
    return frag;
  }

  // ------------------------------------------------------------------ Places view (main panel)
  function placesView() {
    const wrap = h('div');
    const listBox = h('div');
    const draw = () => {
      const items = sortPlaces(allPlaces().filter(p => passesFilters(p) && matchesSearch(p)));
      listBox.replaceChildren(
        h('div', { class: 'count' }, `${items.length} place${items.length === 1 ? '' : 's'}` + (myPos ? ' · distance from you shown, list stays A–Z' : '')),
        listWithGroups(items, p => placeRow(p)));
    };
    wrap.append(filterChips(() => refresh()), searchBox(draw), listBox);
    draw();
    return { title: 'Places', node: wrap, tab: 'places' };
  }

  // ------------------------------------------------------------------ Place card
  function openPlace(id, fromMap) {
    let back;
    if (view.name === 'place') back = view.back;
    else if (['places', 'plan', 'menu', 'pick'].includes(view.name)) back = view;
    else back = { name: 'places', args: {}, back: null };
    saveScroll();
    view = { name: 'place', args: { id }, back };
    render();
    atLeast('half');
    const p = byId(id);
    if (fromMap && hasLoc(p)) focusOn(p, map.getZoom());
  }
  function placeView({ id }) {
    const p = byId(id);
    if (!p) return { title: 'Not found', node: h('p', null, 'This place was removed.') };
    const c = CATS[p.category] || CATS.food;
    const body = h('div', { class: 'stack' });

    if (p.photo) {
      const img = h('img', { src: p.photo.src, alt: `Photo of ${p.name}`, loading: 'lazy' });
      const fig = h('figure', { class: 'photo' }, img,
        h('figcaption', null, 'Photo: ', h('a', { href: p.photo.page, target: '_blank', rel: 'noopener' }, p.photo.credit)));
      img.addEventListener('error', () => fig.remove());
      body.appendChild(fig);
    }
    body.appendChild(h('div', { class: 'row' },
      h('span', { class: 'badge cat', style: `--chip:${c.color}` }, c.label),
      (p.tags || []).map(t => h('span', { class: 'badge' }, TAG_LABEL[t] || t)),
      p.user ? h('span', { class: 'badge' }, 'Added by you') : null,
      h('span', { class: 'muted small' }, [p.district, p.city].filter(Boolean).join(', '))));
    if (p.nameZh && p.nameZh !== p.name) body.appendChild(h('div', { class: 'zh', lang: 'zh-Hant' }, p.nameZh));
    if (p.flag) body.appendChild(h('div', { class: 'flag' }, '⚠️ ' + p.flag));
    if (p.startDate) {
      const on = eventActive(p, today());
      body.appendChild(h('div', { class: on ? 'warn' : 'muted' },
        `📅 ${fmtDate(p.startDate)}${p.endDate && p.endDate !== p.startDate ? ' – ' + fmtDate(p.endDate) : ''}${on ? ' · on now' : ''}`));
    }
    const why = p.why || (p.user || p.category === 'home-base' ? '' : "From Calvin's Google Maps list");
    if (why) body.appendChild(h('div', { class: 'why' }, why));
    if (p.addressZh) body.appendChild(h('div', { class: 'small', lang: 'zh-Hant' }, p.addressZh));
    if (p.address) body.appendChild(h('div', { class: 'muted small' }, p.address));
    if (myPos && hasLoc(p)) {
      const d = distM(myPos, p);
      body.appendChild(h('div', { class: 'small' }, `📍 ${fmtDist(d)} from you · ~${walkMin(d)} min walk (straight-line estimate)`));
    }

    body.appendChild(h('div', { class: 'grid2' },
      h('a', { class: 'btn primary', href: walkUrl(p), target: '_blank', rel: 'noopener' }, '🚶 Walking directions'),
      h('a', { class: 'btn', href: gmapsUrl(p), target: '_blank', rel: 'noopener' }, 'Google Maps ↗')));
    body.appendChild(h('div', { class: 'muted small' }, 'Google Maps has live hours, reviews and more photos.'));

    const hoursBox = h('div');
    if (p.hours) {
      const todayKey = DAYS[parseISO(today()).getDay()];
      hoursBox.append(h('div', { style: 'font-weight:600' }, 'Hours as of Sept 2026, check Google Maps'),
        h('table', { class: 'hours' }, WEEK.filter(d => p.hours[d] !== undefined).map(d =>
          h('tr', { class: d === todayKey ? 'today' : '' }, h('td', null, DAY_LABEL[d]), h('td', null, fmtRanges(p.hours[d]))))));
    } else hoursBox.append(h('div', { style: 'font-weight:600' }, 'Hours: check Google Maps'));
    body.appendChild(hoursBox);

    const visited = !!S.visited[p.id];
    body.appendChild(h('div', { class: 'grid2' },
      h('button', {
        type: 'button', class: 'btn' + (visited ? ' on' : ''), 'aria-pressed': String(visited),
        onclick: () => { if (S.visited[p.id]) delete S.visited[p.id]; else S.visited[p.id] = true; save(); renderMarkers(); refresh(); },
      }, visited ? '✓ Visited' : 'Mark visited'),
      h('button', { type: 'button', class: 'btn', onclick: () => go('addToPlan', { id: p.id }, { fromCurrent: true }) }, '+ Day plan')));

    const ta = h('textarea', { class: 'input', id: 'notes', placeholder: 'Your notes (saved on this phone)' });
    ta.value = S.notes[p.id] != null ? S.notes[p.id] : (p.notes || '');
    const saved = h('span', { class: 'muted small' });
    let nt;
    ta.addEventListener('input', () => {
      clearTimeout(nt); saved.textContent = '…';
      nt = setTimeout(() => {
        if (p.user) { const u = S.userPlaces.find(x => x.id === p.id); if (u) u.notes = ta.value; } else S.notes[p.id] = ta.value;
        save(); saved.textContent = 'Saved';
      }, 350);
    });
    body.appendChild(h('label', { class: 'field', for: 'notes' }, h('span', null, 'Notes '), saved, ta));

    if (p.sources && p.sources.length) {
      body.appendChild(h('div', { class: 'sources' }, h('div', { style: 'font-weight:600' }, 'Sources'),
        p.sources.map(s => h('a', { href: s.url, target: '_blank', rel: 'noopener' }, (s.label || s.url) + ' ↗'))));
    }
    if (p.user && p.link) body.appendChild(h('div', { class: 'sources' }, h('a', { href: p.link, target: '_blank', rel: 'noopener' }, 'Link ↗')));

    body.appendChild(h('div', { class: 'grid2' },
      h('button', { type: 'button', class: 'btn', onclick: () => fixLocation(p.id) }, hasLoc(p) ? '📍 Fix location' : '📍 Set location'),
      hasLoc(p) ? h('button', { type: 'button', class: 'btn', onclick: () => { setPanel('peek'); focusOn(p, Math.max(map.getZoom(), 17)); } }, 'Show on map') : null));
    if (p.fixed) body.appendChild(h('button', {
      type: 'button', class: 'btn small', onclick: () => { delete S.locOverrides[p.id]; save(); renderMarkers(); renderRoute(); refresh(); toast('Location reset to the curated one'); },
    }, 'Undo my location fix'));
    if (p.user) {
      body.appendChild(h('div', { class: 'grid2' },
        h('button', { type: 'button', class: 'btn', onclick: () => go('form', { id: p.id, fresh: true }, { fromCurrent: true }) }, 'Edit'),
        h('button', {
          type: 'button', class: 'btn danger', onclick: () => {
            if (!confirm(`Delete “${p.name}”? This removes it from this phone.`)) return;
            S.userPlaces = S.userPlaces.filter(x => x.id !== p.id);
            delete S.visited[p.id]; delete S.notes[p.id];
            for (const it of Object.values(S.itineraries)) {
              it.stops = (it.stops || []).filter(s => !(s.type === 'place' && s.placeId === p.id));
              it.stops.forEach(s => { if (s.placeId === p.id) s.placeId = null; });
            }
            save(); renderMarkers(); renderRoute(); toast('Deleted'); go('places');
          },
        }, 'Delete')));
    }
    const backName = view.back ? view.back.name : 'places';
    return { title: p.name, node: body, tab: backName === 'pick' ? 'plan' : backName };
  }

  // ------------------------------------------------------------------ map-tap mode
  let panelBeforePick = null;
  function startPick(text, onPick) {
    pick = { text, onPick };
    $('#pickText').textContent = text; $('#pickBar').hidden = false;
    panelBeforePick = $('#panel').dataset.size;
    if (!wide.matches) setPanel('peek', true);
  }
  function endPick() {
    pick = null; $('#pickBar').hidden = true;
    if (panelBeforePick && !wide.matches) setPanel(panelBeforePick, true);
    panelBeforePick = null;
  }
  $('#pickCancel').addEventListener('click', endPick);
  map.on('click', e => {
    if (!pick) return;
    const cb = pick.onPick; endPick(); cb({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) });
  });
  (function longPress() {
    const el = map.getContainer();
    let timer = null, start = null, fired = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.leaflet-marker-icon, .leaflet-control')) return;
      fired = false; start = { x: e.clientX, y: e.clientY }; cancel();
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
    el.addEventListener('click', e => { if (fired) { e.stopPropagation(); fired = false; } }, true);
  })();
  function dropPin(ll) {
    if (pick) { const cb = pick.onPick; endPick(); cb(ll); return; }
    go('form', { fresh: true, preset: ll }, { fromCurrent: true }); atLeast('half');
  }
  function showPickMarker(ll) {
    if (pickMarker) map.removeLayer(pickMarker);
    pickMarker = L.marker([ll.lat, ll.lng], { icon: L.divIcon({ className: 'pick-pin', html: '📍', iconSize: [34, 34], iconAnchor: [17, 32] }) }).addTo(map);
  }
  function clearPickMarker() { if (pickMarker) { map.removeLayer(pickMarker); pickMarker = null; } }
  function fixLocation(id) {
    const p = byId(id);
    startPick(`Tap the map where “${p.name}” is`, ll => {
      if (p.user) { const u = S.userPlaces.find(x => x.id === id); u.lat = ll.lat; u.lng = ll.lng; } else S.locOverrides[id] = ll;
      save(); renderMarkers(); renderRoute(); toast('Location saved'); refresh(); atLeast('half');
    });
    if (hasLoc(p)) focusOn(p, Math.max(map.getZoom(), 17));
  }

  // ------------------------------------------------------------------ add / edit place
  const drafts = {};
  function formView(args) {
    const existing = args.id ? S.userPlaces.find(x => x.id === args.id) : null;
    const key = args.id || 'new';
    if (!drafts[key] || args.fresh) {
      drafts[key] = existing ? JSON.parse(JSON.stringify(existing)) : { id: null, name: '', category: 'food', tags: [], notes: '', link: '', lat: null, lng: null };
      args.fresh = false;
    }
    const d = drafts[key];
    if (args.preset) { d.lat = args.preset.lat; d.lng = args.preset.lng; args.preset = null; }
    if (hasLoc(d)) showPickMarker(d); else clearPickMarker();

    const name = h('input', { type: 'text', value: d.name, autocomplete: 'off', placeholder: 'e.g. Great dumpling shop' });
    const cat = h('select', null, Object.keys(CATS).filter(c => c !== 'home-base').map(c => h('option', { value: c, selected: d.category === c }, CATS[c].label)));
    const tagBoxes = TAGS.map(t => h('label', null, h('input', { type: 'checkbox', value: t, checked: d.tags.includes(t) }), TAG_LABEL[t]));
    const notes = h('textarea'); notes.value = d.notes || '';
    const link = h('input', { type: 'url', value: d.link || '', placeholder: 'https://… (optional)', inputmode: 'url' });
    const collect = () => {
      d.name = name.value.trim(); d.category = cat.value; d.notes = notes.value; d.link = link.value.trim();
      d.tags = tagBoxes.map(l => l.firstChild).filter(i => i.checked).map(i => i.value);
    };
    [name, cat, notes, link].forEach(el => el.addEventListener('input', collect));
    tagBoxes.forEach(l => l.firstChild.addEventListener('change', collect));
    const node = h('form', {
      class: 'stack', onsubmit: e => {
        e.preventDefault(); collect();
        if (!d.name) { toast('Give it a name'); name.focus(); return; }
        if (!hasLoc(d)) { toast('Set a location first'); return; }
        if (d.link && !/^https?:\/\//i.test(d.link)) d.link = 'https://' + d.link;
        d.city = nearestCity(d);
        let id;
        if (existing) { Object.assign(existing, d); id = existing.id; }
        else { id = d.id = 'u-' + Date.now().toString(36); S.userPlaces.push(d); }
        delete drafts[key];
        save(); clearPickMarker();
        renderMarkers(); renderRoute(); toast(existing ? 'Saved' : 'Place added');
        view = { name: 'places', args: {}, back: null }; openPlace(id);
      },
    },
    h('label', { class: 'field' }, 'Name', name),
    h('label', { class: 'field' }, 'Category', cat),
    h('div', null, h('div', { style: 'font-weight:600;font-size:14px' }, 'Tags'), h('div', { class: 'checks' }, tagBoxes)),
    h('div', null, h('div', { style: 'font-weight:600;font-size:14px' }, 'Location'),
      h('div', { class: hasLoc(d) ? 'muted small' : 'warn' }, hasLoc(d) ? `📍 ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}` : 'No location yet — use GPS or tap the map')),
    h('div', { class: 'grid2' },
      h('button', {
        type: 'button', class: 'btn', onclick: () => {
          collect();
          getPosition(pos => { d.lat = +pos.lat.toFixed(6); d.lng = +pos.lng.toFixed(6); focusOn(d, 17); refresh(); });
        },
      }, '◎ Use my GPS'),
      h('button', { type: 'button', class: 'btn', onclick: () => { collect(); startPick('Tap the map to place the pin', ll => { d.lat = ll.lat; d.lng = ll.lng; refresh(); }); } }, '👆 Tap the map')),
    h('div', { class: 'muted small' }, 'Tip: long-press anywhere on the map to start a new place there.'),
    h('label', { class: 'field' }, 'Notes', notes),
    h('label', { class: 'field' }, 'Link', link),
    h('button', { type: 'submit', class: 'btn primary block' }, existing ? 'Save changes' : 'Add place'),
    );
    return { title: existing ? 'Edit place' : 'Add a place', node, tab: existing ? 'places' : 'add' };
  }
  function nearestCity(ll) {
    const tc = byId(HOME_ID);
    const tp = { lat: 25.04, lng: 121.53 }; // only used to label a user-added place Taichung vs Taipei
    return distM(ll, tc) < distM(ll, tp) ? 'Taichung' : 'Taipei';
  }

  // ------------------------------------------------------------------ geolocation (dot + follow mode)
  let watchId = null, follow = false, locateWaiters = [], firstFix = true;
  function drawMe() {
    meLayer.clearLayers();
    if (!myPos) return;
    L.circle([myPos.lat, myPos.lng], { radius: Math.min(myPos.acc || 0, 300), color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }).addTo(meLayer);
    L.marker([myPos.lat, myPos.lng], { icon: L.divIcon({ className: 'me-dot', html: '<div></div>', iconSize: [24, 24], iconAnchor: [12, 12] }), interactive: false, zIndexOffset: 2000 }).addTo(meLayer);
  }
  function setFollow(on) {
    follow = on;
    $('#btnLocate').classList.toggle('follow', on);
    $('#btnLocate').setAttribute('aria-label', on ? 'Following your location (tap to stop)' : 'Show and follow my location');
  }
  function startWatch() {
    if (!('geolocation' in navigator)) { toast('Location is not available in this browser'); return false; }
    if (watchId != null) return true;
    watchId = navigator.geolocation.watchPosition(pos => {
      const had = !!myPos;
      myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
      drawMe(); $('#btnLocate').classList.add('on');
      if (follow) { focusOn(myPos, firstFix ? Math.max(map.getZoom(), 16) : map.getZoom()); firstFix = false; }
      const w = locateWaiters; locateWaiters = []; w.forEach(f => f(myPos));
      if (!had && ['places', 'place', 'plan'].includes(view.name)) refresh(); // show distances once we know where you are
    }, err => {
      toast(err.code === 1 ? 'Location permission denied — allow it in your browser settings' : 'Could not get your location');
      setFollow(false); locateWaiters = [];
      if (err.code === 1) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    return true;
  }
  function getPosition(cb) {
    if (myPos) { cb(myPos); return; }
    if (startWatch()) { locateWaiters.push(cb); toast('Finding you…'); }
  }
  $('#btnLocate').addEventListener('click', () => {
    if (follow) { setFollow(false); toast('Stopped following'); return; }
    setFollow(true); firstFix = true;
    if (myPos) { focusOn(myPos, Math.max(map.getZoom(), 16)); firstFix = false; toast('Following you — drag the map to stop'); }
    else if (startWatch()) toast('Finding you…');
  });
  map.on('dragstart', () => { if (follow) setFollow(false); });

  // ------------------------------------------------------------------ itinerary data
  function itin(date) {
    if (!S.itineraries[date]) S.itineraries[date] = { start: HOME_ID, stops: [] };
    const it = S.itineraries[date];
    if (!Array.isArray(it.stops)) it.stops = [];
    return it;
  }
  function itinDate() {
    let d = S.settings.itinDate;
    if (!d || d < TRIP_START || d > TRIP_END) { const t = today(); d = (t >= TRIP_START && t <= TRIP_END) ? t : TRIP_START; }
    return d;
  }
  // Visiting order: timed stops by time (ties keep insertion order), then stops with no time.
  function seq(it) {
    return it.stops.map((s, i) => [s, i]).sort((a, b) => {
      const ta = a[0].time ? toMin(a[0].time) : Infinity, tb = b[0].time ? toMin(b[0].time) : Infinity;
      return (ta - tb) || (a[1] - b[1]);
    }).map(x => x[0]);
  }
  function stopPlace(s) { return s.placeId ? byId(s.placeId) : null; }
  function stopLoc(s) { const p = stopPlace(s); return hasLoc(p) ? { lat: p.lat, lng: p.lng } : null; }
  function stopTitle(s) { if (s.type === 'custom') return s.title || 'Untitled'; const p = stopPlace(s); return p ? p.name : '(deleted place)'; }
  function startLoc(it) {
    if (it.start === 'me') return myPos ? { lat: myPos.lat, lng: myPos.lng } : null;
    const p = byId(it.start); return hasLoc(p) ? { lat: p.lat, lng: p.lng } : null;
  }
  function startLabel(it) { if (it.start === 'me') return 'My location'; const p = byId(it.start); return p ? p.name : 'Home base'; }
  function newStopId() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function slotTime(slot) { return slot === 'any' ? null : pad(slot) + ':00'; }
  function slotLabel(slot) { return slot === 'any' ? 'any time' : pad(slot) + ':00'; }
  function slotOf(s) { return s.time ? parseInt(s.time, 10) : 'any'; }

  function addStop(date, placeId, slot) {
    itin(date).stops.push({ id: newStopId(), type: 'place', placeId, time: slotTime(slot) });
    save(); renderRoute();
  }
  function moveStop(date, stopId, slot) {
    const it = itin(date);
    const i = it.stops.findIndex(s => s.id === stopId);
    if (i < 0) return;
    const [s] = it.stops.splice(i, 1);
    if (slot === 'any') s.time = null;
    else if (!s.time || parseInt(s.time, 10) !== slot) s.time = slotTime(slot);
    it.stops.push(s);
    save(); renderRoute();
  }
  // Nearest-neighbour from the start; the times already used are handed out in the new order.
  function suggestOrder(it) {
    let cur = startLoc(it);
    if (!cur) { toast(it.start === 'me' ? 'Turn on location first (arrow button), or pick a different start' : 'Start has no location'); return; }
    const ordered = seq(it);
    const times = ordered.map(s => s.time).filter(Boolean);
    const withLoc = ordered.filter(s => stopLoc(s)), without = ordered.filter(s => !stopLoc(s));
    const out = [];
    while (withLoc.length) {
      let bi = 0, bd = Infinity;
      withLoc.forEach((s, i) => { const d = distM(cur, stopLoc(s)); if (d < bd) { bd = d; bi = i; } });
      const [s] = withLoc.splice(bi, 1); out.push(s); cur = stopLoc(s);
    }
    const all = out.concat(without);
    all.forEach((s, i) => { s.time = i < times.length ? times[i] : null; });
    it.stops = all;
    save(); renderRoute();
    toast(times.length ? 'Reordered for walking; your times were kept in order' : 'Reordered by nearest next stop');
  }

  // ------------------------------------------------------------------ Day plan view
  function planView() {
    const date = itinDate();
    S.settings.itinDate = date;
    const it = itin(date);
    const node = h('div', { style: 'display:flex;flex-direction:column;height:100%;min-height:0' });

    const homes = allPlaces().filter(p => p.category === 'home-base');
    node.appendChild(h('div', { class: 'plan-top' },
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, 'Date', h('select', {
          onchange: e => { S.settings.itinDate = e.target.value; save(); renderRoute(); fitRoute(); refresh(); },
        }, tripDates().map(d => h('option', { value: d, selected: d === date }, fmtDate(d) + (S.itineraries[d] && S.itineraries[d].stops.length ? ` · ${S.itineraries[d].stops.length}` : ''))))),
        h('label', { class: 'field' }, 'Start from', h('select', {
          onchange: e => { it.start = e.target.value; save(); renderRoute(); refresh(); },
        }, homes.map(p => h('option', { value: p.id, selected: it.start === p.id }, p.name.replace(/ \(.*$/, '').replace(/,.*$/, ''))),
        h('option', { value: 'me', selected: it.start === 'me' }, 'My location')))),
      h('div', { class: 'plan-actions' },
        h('button', { type: 'button', class: 'btn', disabled: it.stops.length < 2 ? true : null, onclick: () => { suggestOrder(it); refresh(); } }, '🚶 Suggest order'),
        h('button', { type: 'button', class: 'btn', onclick: () => go('custom', { date, slot: 'any' }, { fromCurrent: true }) }, '+ Custom'),
        h('button', { type: 'button', class: 'btn' + (S.settings.showRoute ? ' on' : ''), onclick: () => { S.settings.showRoute = !S.settings.showRoute; save(); renderRoute(); if (S.settings.showRoute) fitRoute(); refresh(); } }, S.settings.showRoute ? 'Route: on' : 'Route: off')),
      (date >= LONG_WEEKEND[0] && date <= LONG_WEEKEND[1]) ? h('div', { class: 'flag', style: 'margin-top:8px' }, 'National Day long weekend — expect crowds.') : null,
      (it.start === 'me' && !myPos) ? h('div', { class: 'warn', style: 'margin-top:8px' }, 'Tap the arrow button on the map to turn on location.') : null));

    // --- timeslots
    const slotsEl = h('div', { class: 'slots', 'data-scroll': 'slots' });
    const order = seq(it);
    const numOf = new Map(order.map((s, i) => [s.id, i + 1]));
    const prevLoc = new Map();
    let last = startLoc(it);
    for (const s of order) { prevLoc.set(s.id, last); const l = stopLoc(s); if (l) last = l; }
    slotsEl.appendChild(h('div', { class: 'muted small', style: 'padding:4px 0 6px' }, '🏠 Start: ' + startLabel(it)));
    const hours = new Set(SLOT_HOURS);
    order.forEach(s => { if (s.time) hours.add(parseInt(s.time, 10)); });
    const slotKeys = [...hours].sort((a, b) => a - b).concat(['any']);
    for (const key of slotKeys) {
      const stops = order.filter(s => slotOf(s) === key);
      slotsEl.appendChild(h('div', { class: 'slot', 'data-slot': String(key) },
        h('div', { class: 'slot-time' }, key === 'any' ? 'Any time' : pad(key) + ':00'),
        h('div', { class: 'slot-body' },
          stops.map(s => stopEl(it, s, numOf.get(s.id), prevLoc.get(s.id), date)),
          h('button', { type: 'button', class: 'slot-add', onclick: () => go('pick', { date, slot: key }, { fromCurrent: true }) },
            stops.length ? '+ add' : '+ Tap to add'))));
    }
    slotsEl.appendChild(h('div', { class: 'muted small', style: 'padding-top:8px' },
      `Distances are straight lines; walking times assume about ${WALK_M_PER_MIN} m/min. Both are estimates — “Directions” opens the real walking route in Google Maps.`));
    node.appendChild(slotsEl);

    // --- place pool to drag from
    const pool = h('div', { class: 'pool', 'data-scroll': 'pool' });
    const listBox = h('div');
    const nearOpts = [['off', 'Anywhere'], ['center', 'Nearby: ~1 km of map center']];
    if (myPos) nearOpts.push(['me', 'Nearby: ~1 km of me']);
    order.forEach(s => { if (stopLoc(s)) nearOpts.push(['stop:' + s.id, `Nearby: ~1 km of #${numOf.get(s.id)} ${stopTitle(s)}`]); });
    if (!nearOpts.some(o => o[0] === nearKey)) nearKey = 'off';
    const nearOrigin = () => {
      if (nearKey === 'me') return myPos;
      if (nearKey === 'center') { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; }
      if (nearKey.startsWith('stop:')) { const s = it.stops.find(x => x.id === nearKey.slice(5)); return s ? stopLoc(s) : null; }
      return null;
    };
    const draw = () => {
      const origin = nearOrigin();
      const inPlan = new Set(it.stops.map(s => s.placeId));
      let items = allPlaces().filter(p => p.category !== 'home-base' && passesFilters(p) && matchesSearch(p));
      if (origin) items = items.filter(p => hasLoc(p) && distM(origin, p) <= NEARBY_M);
      items = sortPlaces(items);
      listBox.replaceChildren(
        h('div', { class: 'count' }, `${items.length} place${items.length === 1 ? '' : 's'}` + (origin ? ' nearby (A–Z, not by distance)' : '')),
        listWithGroups(items, p => {
          const hs = hoursStatus(p, date, null);
          const extra = [inPlan.has(p.id) ? 'in plan' : null, origin ? fmtDist(distM(origin, p)) : null, hs ? hs.msg : null].filter(Boolean).join(' · ');
          return placeRow(p, {
            handle: true, extra: extra || null,
            right: h('button', { type: 'button', class: 'btn small add-mini', 'aria-label': `Add ${p.name} at any time`, onclick: () => { addStop(date, p.id, 'any'); toast(`Added to ${fmtDate(date)} (any time)`); refresh(); } }, '+'),
          });
        }));
    };
    pool.appendChild(h('div', { class: 'pool-head' },
      h('div', { class: 'hint' }, 'Drag ⠿ onto a time, or tap a time to pick a place.'),
      filterChips(() => refresh()),
      h('div', { class: 'grid2 pool-row' }, searchBox(draw),
        h('select', { class: 'input', 'aria-label': 'Nearby ideas', onchange: e => { nearKey = e.target.value; draw(); } },
          nearOpts.map(([v, l]) => h('option', { value: v, selected: v === nearKey }, l))))));
    pool.appendChild(listBox);
    draw();
    node.appendChild(pool);
    return { title: 'Day plan · ' + fmtDate(date), node, fill: true, tab: 'plan' };
  }

  function stopEl(it, s, n, from, date) {
    const p = stopPlace(s);
    const loc = stopLoc(s);
    const warns = [];
    if (p && p.flag) warns.push(h('div', { class: 'warn' }, '⚠️ ' + p.flag));
    const hs = p ? hoursStatus(p, date, s.time) : null;
    if (hs) warns.push(h('div', { class: 'bad' }, '⏰ ' + hs.msg));
    if (p && p.category === 'event' && !eventActive(p, date)) warns.push(h('div', { class: 'bad' }, `📅 Not on ${fmtDate(date)} (${fmtDate(p.startDate)} – ${fmtDate(p.endDate)})`));
    if (s.placeId && !loc) warns.push(h('div', { class: 'warn' }, 'This place needs a location'));
    let leg = null;
    if (loc && from) {
      const d = distM(from, loc), far = d > FAR_M;
      leg = h('div', { class: 'leg' + (far ? ' far' : '') },
        `↓ ${fmtDist(d)} · ~${walkMin(d)} min walk (est.)` + (far ? ' · probably not walkable' : ''),
        h('a', { href: walkUrl(loc, from), target: '_blank', rel: 'noopener' }, 'Directions ↗'));
    } else if (s.placeId && !loc) leg = h('div', { class: 'leg' }, '↓ distance unknown');
    const time = h('input', {
      type: 'time', class: 'input time', value: s.time || '', 'aria-label': 'Planned time',
      onchange: e => { s.time = e.target.value || null; save(); renderRoute(); refresh(); },
    });
    return h('div', null, leg,
      h('div', { class: 'stop' },
        h('div', { class: 'top' },
          h('button', { type: 'button', class: 'handle', 'aria-label': 'Drag to another time', onpointerdown: e => startDrag(e, { type: 'stop', stopId: s.id }, stopTitle(s)) }, '⠿'),
          h('span', { class: 'num' }, String(n)),
          h('button', {
            type: 'button', class: 'title',
            onclick: () => p ? openPlace(p.id) : go('custom', { date, id: s.id }, { fromCurrent: true }),
          }, (s.type === 'custom' ? '🗓️ ' : '') + stopTitle(s) + (s.type === 'custom' && p ? ` @ ${p.name}` : '')),
          h('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Remove stop', onclick: () => { it.stops = it.stops.filter(x => x !== s); save(); renderRoute(); refresh(); } }, '✕')),
        h('div', { class: 'meta' }, time, p && hasLoc(p) ? h('a', { class: 'small', href: walkUrl(p), target: '_blank', rel: 'noopener' }, '🚶 from me ↗') : null),
        warns.length ? h('div', { class: 'warns' }, warns) : null));
  }

  // Tap a timeslot → pick a place for it.
  function pickView({ date, slot }) {
    const wrap = h('div', { class: 'stack' });
    const listBox = h('div');
    const draw = () => {
      const items = sortPlaces(allPlaces().filter(p => p.category !== 'home-base' && passesFilters(p) && matchesSearch(p)));
      listBox.replaceChildren(h('div', { class: 'count' }, `${items.length} places — tap one to add it`),
        listWithGroups(items, p => {
          const hs = hoursStatus(p, date, slotTime(slot));
          return placeRow(p, { extra: hs ? '⏰ ' + hs.msg : null, onTap: q => { addStop(date, q.id, slot); toast(`Added ${q.name} at ${slotLabel(slot)}`); goBack(); } });
        }));
    };
    wrap.append(
      h('button', { type: 'button', class: 'btn block', onclick: () => go('custom', { date, slot }, { back: view.back }) }, `+ Custom entry at ${slotLabel(slot)}`),
      h('div', null, filterChips(() => refresh()), searchBox(draw)), listBox);
    draw();
    return { title: `Add at ${slotLabel(slot)} · ${fmtDate(date)}`, node: wrap, tab: 'plan' };
  }

  function customView({ date, slot, id }) {
    const it = itin(date);
    const s = id ? it.stops.find(x => x.id === id) : null;
    const title = h('input', { type: 'text', value: s ? s.title : '', placeholder: 'e.g. Lunch with family' });
    const time = h('input', { type: 'time', value: s ? (s.time || '') : (slotTime(slot) || '') });
    const opts = allPlaces().slice().sort((a, b) => a.name.localeCompare(b.name));
    const place = h('select', null, h('option', { value: '' }, '— none —'), opts.map(p => h('option', { value: p.id, selected: s && s.placeId === p.id }, p.name)));
    const node = h('form', {
      class: 'stack', onsubmit: e => {
        e.preventDefault();
        if (!title.value.trim()) { toast('Add a title'); return; }
        const data = { title: title.value.trim(), time: time.value || null, placeId: place.value || null };
        if (s) Object.assign(s, data); else it.stops.push(Object.assign({ id: newStopId(), type: 'custom' }, data));
        save(); renderRoute(); goBack();
      },
    },
    h('label', { class: 'field' }, 'Title', title),
    h('label', { class: 'field' }, 'Time', time),
    h('label', { class: 'field' }, 'Place (optional)', place),
    h('button', { type: 'submit', class: 'btn primary block' }, s ? 'Save' : 'Add entry'),
    s ? h('button', { type: 'button', class: 'btn danger block', onclick: () => { it.stops = it.stops.filter(x => x !== s); save(); renderRoute(); goBack(); } }, 'Remove entry') : null);
    return { title: (s ? 'Edit entry · ' : 'Custom entry · ') + fmtDate(date), node, tab: 'plan' };
  }

  function addToPlanView({ id }) {
    const p = byId(id);
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
    const node = h('form', {
      class: 'stack', onsubmit: e => {
        e.preventDefault();
        itin(dateSel.value).stops.push({ id: newStopId(), type: 'place', placeId: id, time: time.value || null });
        S.settings.itinDate = dateSel.value; save(); renderRoute();
        toast(`Added to ${fmtDate(dateSel.value)}`);
        goBack();
      },
    },
    h('label', { class: 'field' }, 'Date', dateSel),
    h('label', { class: 'field' }, 'Time (optional)', time),
    status,
    h('button', { type: 'submit', class: 'btn primary block' }, 'Add to day plan'));
    check();
    return { title: 'Add “' + p.name + '”', node, tab: 'plan' };
  }

  // ------------------------------------------------------------------ drag and drop (pointer events: touch and mouse)
  let drag = null;
  function startDrag(e, payload, label) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const ghost = h('div', { class: 'drag-ghost' }, label);
    document.body.appendChild(ghost);
    document.body.classList.add('dragging');
    drag = { payload, ghost, over: null, x: e.clientX, y: e.clientY, date: itinDate() };
    moveGhost(e.clientX, e.clientY);
    const move = ev => { if (!drag) return; drag.x = ev.clientX; drag.y = ev.clientY; moveGhost(ev.clientX, ev.clientY); ev.preventDefault(); };
    const detach = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); };
    const up = () => {
      detach();
      if (!drag) return;
      const target = drag.over, date = drag.date;
      endDrag();
      if (target == null) return;
      const slot = target === 'any' ? 'any' : parseInt(target, 10);
      if (payload.type === 'place') { addStop(date, payload.placeId, slot); toast(`Added at ${slotLabel(slot)}`); }
      else moveStop(date, payload.stopId, slot);
      refresh();
    };
    const cancel = () => { detach(); endDrag(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    drag.timer = setInterval(autoScroll, 30);
  }
  function moveGhost(x, y) {
    drag.ghost.style.left = x + 'px'; drag.ghost.style.top = y + 'px';
    const el = document.elementFromPoint(x, y);
    const slot = el && el.closest('.slot');
    document.querySelectorAll('.slot.over').forEach(s => { if (s !== slot) s.classList.remove('over'); });
    if (slot) slot.classList.add('over');
    drag.over = slot ? slot.dataset.slot : null;
  }
  function autoScroll() {
    if (!drag) return;
    const box = document.querySelector('.slots');
    if (!box) return;
    const r = box.getBoundingClientRect();
    if (drag.x < r.left || drag.x > r.right) return;
    if (drag.y < r.top + 40 && drag.y > r.top - 60) box.scrollTop -= 14;
    else if (drag.y > r.bottom - 40 && drag.y < r.bottom + 30) box.scrollTop += 14;
    else return;
    moveGhost(drag.x, drag.y);
  }
  function endDrag() {
    if (!drag) return;
    clearInterval(drag.timer);
    drag.ghost.remove();
    document.body.classList.remove('dragging');
    document.querySelectorAll('.slot.over').forEach(s => s.classList.remove('over'));
    drag = null;
  }

  // ------------------------------------------------------------------ route on the map
  function routePoints() {
    const it = S.itineraries[itinDate()];
    if (!it) return [];
    const pts = [];
    const st = startLoc(it); if (st) pts.push({ ll: st, n: 0 });
    seq(it).forEach((s, i) => { const l = stopLoc(s); if (l) pts.push({ ll: l, n: i + 1, s }); });
    return pts;
  }
  function renderRoute() {
    routeLayer.clearLayers();
    if (!S.settings.showRoute) return;
    const pts = routePoints();
    if (!pts.some(p => p.n > 0)) return;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1].ll, b = pts[i].ll;
      const far = distM(a, b) > FAR_M;
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: far ? '#dc2626' : '#2563eb', weight: 6, opacity: .85, dashArray: far ? '10 10' : null, lineCap: 'round', interactive: false }).addTo(routeLayer);
    }
    pts.filter(p => p.n > 0).forEach(p => {
      L.marker([p.ll.lat, p.ll.lng], {
        icon: L.divIcon({ className: 'rt', html: `<div>${p.n}</div>`, iconSize: [26, 26], iconAnchor: [13, 34] }),
        zIndexOffset: 1500, title: `Stop ${p.n}: ${stopTitle(p.s)}`,
      }).on('click', () => { if (!pick) { go('plan'); atLeast('half'); } }).addTo(routeLayer);
    });
  }
  function fitRoute() {
    const pts = routePoints();
    if (pts.filter(p => p.n > 0).length === 0 || !S.settings.showRoute) return;
    map.fitBounds(L.latLngBounds(pts.map(p => [p.ll.lat, p.ll.lng])), Object.assign({ maxZoom: 17 }, fitPadding()));
  }

  // ------------------------------------------------------------------ More, date, backup
  function menuView() {
    const need = needsLocation();
    const body = h('div', { class: 'stack' });
    body.appendChild(h('h3', null, `Needs location (${need.length})`));
    if (!need.length) body.appendChild(h('p', { class: 'muted' }, 'Every place has a location. 🎉'));
    else {
      body.appendChild(h('p', { class: 'muted small' }, 'These couldn’t be placed automatically. Tap “Set”, then tap the map. “Maps” shows where it is.'));
      body.appendChild(h('ul', { class: 'plist' }, need.map(p => h('li', null, placeRow(p, {
        right: h('span', { class: 'row', style: 'flex-wrap:nowrap' },
          h('a', { class: 'btn small', href: gmapsUrl(p), target: '_blank', rel: 'noopener' }, 'Maps'),
          h('button', { type: 'button', class: 'btn small primary', onclick: () => fixLocation(p.id) }, 'Set')),
      })))));
    }
    body.appendChild(h('h3', null, 'Backup'));
    body.appendChild(h('p', { class: 'muted small' },
      'Your visited marks, notes, added places, location fixes and day plans are saved only in this browser on this phone. Clearing browser data or switching phones loses them — export a backup now and then.'));
    body.appendChild(h('div', { class: 'grid2' },
      h('button', { type: 'button', class: 'btn primary', onclick: exportData }, '⬇ Export my data'),
      h('button', { type: 'button', class: 'btn', onclick: () => $('#importFile').click() }, '⬆ Import')));
    body.appendChild(h('div', { class: 'muted small' },
      `${Object.keys(S.visited).length} visited · ${Object.values(S.notes).filter(Boolean).length} notes · ${S.userPlaces.length} added · ${Object.values(S.itineraries).reduce((n, it) => n + (it.stops || []).length, 0)} plan stops`));
    body.appendChild(h('h3', null, 'Date for events'));
    body.appendChild(dateControls());
    body.appendChild(h('h3', null, 'About'));
    body.appendChild(h('p', { class: 'muted small' },
      `${curated.length} curated places. Hours are a snapshot as of Sept 2026 — always check Google Maps. Walking times are straight-line estimates; “Walking directions” opens Google Maps for the real route. Photos come from Wikimedia Commons where one exists.`));
    body.appendChild(h('p', { class: 'small' },
      'Map data © ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap contributors'), ' · ',
      h('a', { href: 'https://www.openstreetmap.org/fixthemap', target: '_blank', rel: 'noopener' }, 'Report a map issue ↗')));
    return { title: 'More', node: body, tab: 'menu' };
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
            renderTop(); renderMarkers(); refresh(); toast('Showing events for ' + fmtDate(today()));
          },
        }, 'Use this date'),
        h('button', { type: 'button', class: 'btn', onclick: () => { S.settings.todayOverride = null; save(); renderTop(); renderMarkers(); refresh(); toast('Back to the real date'); } }, 'Real today')));
  }
  function dateView() { return { title: 'Date', node: dateControls(), tab: 'menu' }; }

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
      renderAll(); toast('Backup restored');
    } catch (err) { toast('Import failed: ' + err.message); }
  });

  const VIEWS = { places: placesView, place: placeView, plan: planView, pick: pickView, custom: customView, addToPlan: addToPlanView, form: formView, menu: menuView, date: dateView };

  // ------------------------------------------------------------------ wiring
  function renderAll() { renderTop(); renderMarkers(); renderRoute(); refresh(); }
  document.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => goCity(b.dataset.city)));
  $('#datePill').addEventListener('click', () => { go('date', {}, { fromCurrent: true }); atLeast('half'); });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    const tab = t.dataset.tab;
    if (view.name !== 'form') clearPickMarker();
    if (tab === 'places') go('places');
    else if (tab === 'plan') { go('plan'); atLeast('full'); fitRoute(); return; }
    else if (tab === 'add') go('form', { fresh: true });
    else if (tab === 'menu') go('menu');
    atLeast('half');
  }));
  $('#panelBack').addEventListener('click', goBack);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (pick) endPick(); else if (drag) endDrag(); else goBack();
  });

  setPanel(S.settings.panel || 'peek', true);
  render();
  fetch('places.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(data => {
      curated = data;
      renderAll();
      if (S.settings.city === 'Taipei') goCity('Taipei');
      else focusOn(byId(HOME_ID), 15);
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(r => { if (r.state === 'granted') startWatch(); }).catch(() => {});
      }
    })
    .catch(err => { toast('Could not load places.json (' + err.message + ')'); });

  // Exposed for debugging in the console only.
  window.twmap = { get state() { return S; }, map, cluster, homeLayer, routeLayer, allPlaces, hoursStatus, isShown, go, get view() { return view; } };
})();
