/* global L, window */

(function () {
  'use strict';

  const ORS_API_KEY = '5b3ce3597851110001cf6248a355b583a8914f1a9b30a3f64a60f1c0';
  const ORS_BASE    = 'https://api.openrouteservice.org/v2/directions';
  const NOM_BASE    = 'https://nominatim.openstreetmap.org/search';
  const SPEEDS      = { car: 28, scooter: 35, bike: 16 };

  let map = null;
  let fromMarker = null;
  let toMarker   = null;
  let routeLayers = [];
  let lastResult  = null;
  let nomTimers   = {};

  // ── Wait for Leaflet then init ──────────────────────
  function waitForLeaflet(cb, tries) {
    tries = tries || 0;
    if (window.L) { cb(); return; }
    if (tries > 30) { console.error('[map.js] Leaflet never loaded'); return; }
    setTimeout(() => waitForLeaflet(cb, tries + 1), 200);
  }

  function init() {
    const mapEl = document.getElementById('route-map');
    if (!mapEl) return;

    map = L.map('route-map', {
      center: [44.4268, 26.1025],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', onMapClick);
    bindSearchInputs();
    bindButtons();
  }

  // ── Map click ───────────────────────────────────────
  function onMapClick(e) {
    if (!fromMarker) {
      setFromMarker(e.latlng);
    } else if (!toMarker) {
      setToMarker(e.latlng);
      tryRoute();
    } else {
      // Third click → reset from
      if (fromMarker) map.removeLayer(fromMarker);
      if (toMarker)   map.removeLayer(toMarker);
      fromMarker = toMarker = null;
      clearRoutes();
      setFromMarker(e.latlng);
    }
  }

  function makeIcon(color, label) {
    return L.divIcon({
      className: '',
      html: `<div style="width:28px;height:28px;background:${color};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;">
               <span style="transform:rotate(45deg);color:#fff;font-weight:700;font-size:12px;line-height:1;">${label}</span>
             </div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });
  }

  function setFromMarker(latlng) {
    if (fromMarker) map.removeLayer(fromMarker);
    fromMarker = L.marker(latlng, { icon: makeIcon('#4F8EF7', 'A'), draggable: true }).addTo(map);
    fromMarker.on('dragend', () => { if (fromMarker && toMarker) tryRoute(); });
  }

  function setToMarker(latlng) {
    if (toMarker) map.removeLayer(toMarker);
    toMarker = L.marker(latlng, { icon: makeIcon('#E05A3A', 'B'), draggable: true }).addTo(map);
    toMarker.on('dragend', () => { if (fromMarker && toMarker) tryRoute(); });
  }

  function clearRoutes() {
    routeLayers.forEach(l => map.removeLayer(l));
    routeLayers = [];
  }

  // ── Search inputs ───────────────────────────────────
  function bindSearchInputs() {
    setupSearch('search-from', 'autocomplete-from', 'from');
    setupSearch('search-to',   'autocomplete-to',   'to');
  }

  function setupSearch(inputId, listId, type) {
    const input = document.getElementById(inputId);
    const list  = document.getElementById(listId);
    if (!input || !list) return;

    input.addEventListener('input', () => {
      clearTimeout(nomTimers[type]);
      const q = input.value.trim();
      if (q.length < 3) { closeDropdown(list); return; }
      nomTimers[type] = setTimeout(() => nominatimSearch(q, list, input, type), 400);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeDropdown(list);
    });

    document.addEventListener('click', e => {
      if (!input.contains(e.target) && !list.contains(e.target)) closeDropdown(list);
    });
  }

  async function nominatimSearch(query, listEl, inputEl, type) {
    try {
      const url = `${NOM_BASE}?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1&accept-language=en`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      renderDropdown(data, listEl, inputEl, type);
    } catch (err) {
      console.warn('[map.js] Nominatim error:', err);
    }
  }

  function renderDropdown(results, listEl, inputEl, type) {
    listEl.innerHTML = '';
    if (!results.length) { closeDropdown(listEl); return; }
    results.forEach(r => {
      const parts = r.display_name.split(',');
      const name   = parts.slice(0, 2).join(', ').trim();
      const detail = parts.slice(2, 4).join(', ').trim();
      const li = document.createElement('li');
      li.innerHTML = `<div class="place-name">${name}</div><div class="place-detail">${detail}</div>`;
      li.addEventListener('mousedown', e => {
        e.preventDefault(); // prevents blur before click registers
        inputEl.value = name;
        closeDropdown(listEl);
        const latlng = L.latLng(parseFloat(r.lat), parseFloat(r.lon));
        if (type === 'from') {
          setFromMarker(latlng);
          map.setView(latlng, Math.max(map.getZoom(), 13));
        } else {
          setToMarker(latlng);
          map.setView(latlng, Math.max(map.getZoom(), 13));
        }
        if (fromMarker && toMarker) tryRoute();
      });
      listEl.appendChild(li);
    });
    listEl.classList.add('open');
  }

  function closeDropdown(listEl) {
    listEl.classList.remove('open');
    listEl.innerHTML = '';
  }

  // ── Buttons ─────────────────────────────────────────
  function bindButtons() {
    const btnCalc = document.getElementById('btn-calculate-route');
    if (btnCalc) btnCalc.addEventListener('click', () => {
      if (fromMarker && toMarker) tryRoute();
      else {
        alert('Please place two points on the map or type addresses in the search boxes.');
      }
    });

    const btnChallenge = document.getElementById('btn-challenge-calc');
    if (btnChallenge) btnChallenge.addEventListener('click', computeChallengeMini);
  }

  // ── Route calculation ───────────────────────────────
  async function tryRoute() {
    if (!fromMarker || !toMarker) return;

    const from = [fromMarker.getLatLng().lng, fromMarker.getLatLng().lat];
    const to   = [toMarker.getLatLng().lng,   toMarker.getLatLng().lat];

    showLoading(true);

    try {
      const [carRes, bikeRes] = await Promise.all([
        fetchORS(from, to, 'driving-car'),
        fetchORS(from, to, 'cycling-road'),
      ]);

      const scooterRes = {
        distanceKm:  carRes.distanceKm,
        durationMin: (carRes.distanceKm / SPEEDS.scooter) * 60 * 1.15,
        geometry:    carRes.geometry,
        profile:     'scooter',
      };

      // Transit estimate: same distance at 20 km/h effective + 10 min walk/wait
      const transitRes = {
        distanceKm:  carRes.distanceKm,
        durationMin: (carRes.distanceKm / 20) * 60 + 10,
        geometry:    null,
        profile:     'transit',
        fallback:    true,
      };

      lastResult = { car: carRes, scooter: scooterRes, bike: bikeRes, transit: transitRes };

    } catch (err) {
      console.warn('[map.js] ORS failed, using fallback:', err);
      const fromLL = fromMarker.getLatLng();
      const toLL   = toMarker.getLatLng();
      const km     = (fromLL.distanceTo(toLL) / 1000) * 1.35;

      lastResult = {
        car:     { distanceKm: km, durationMin: (km / SPEEDS.car)     * 60,         profile: 'car',     geometry: null, fallback: true },
        scooter: { distanceKm: km, durationMin: (km / SPEEDS.scooter) * 60 * 1.15,  profile: 'scooter', geometry: null, fallback: true },
        bike:    { distanceKm: km, durationMin: (km / SPEEDS.bike)    * 60,          profile: 'bike',    geometry: null, fallback: true },
        transit: { distanceKm: km, durationMin: (km / 20)             * 60 + 10,    profile: 'transit', geometry: null, fallback: true },
      };
    }

    showLoading(false);
    displayResults(lastResult);
    drawRoutes(lastResult);

    // Sync to other modules
    window.dispatchEvent(new CustomEvent('routeReady', { detail: lastResult }));
    if (window.updateChallengeCounter) window.updateChallengeCounter(lastResult.car.durationMin);

    // Sync time-value slider
    syncTimeValue(lastResult);
  }

  async function fetchORS(fromLngLat, toLngLat, profile) {
    const res = await fetch(`${ORS_BASE}/${profile}/geojson`, {
      method: 'POST',
      headers: {
        'Authorization': ORS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        coordinates: [fromLngLat, toLngLat],
        instructions: false,
        units: 'km',
      }),
    });
    if (!res.ok) throw new Error(`ORS ${profile}: ${res.status}`);
    const data = await res.json();
    const feat = data.features[0];
    return {
      distanceKm:  feat.properties.summary.distance,
      durationMin: feat.properties.summary.duration / 60,
      geometry:    feat.geometry,
      profile,
    };
  }

  // ── Draw routes ─────────────────────────────────────
  function drawRoutes(result) {
    clearRoutes();
    if (result.car.geometry) {
      const carLine = L.geoJSON(result.car.geometry, {
        style: { color: '#E05A3A', weight: 4, opacity: 0.7, dashArray: '8 5' },
      }).addTo(map);
      routeLayers.push(carLine);
      try { map.fitBounds(carLine.getBounds(), { padding: [50, 50] }); } catch (_) {}
    }
    if (result.bike.geometry) {
      const bikeLine = L.geoJSON(result.bike.geometry, {
        style: { color: '#3EC278', weight: 4, opacity: 0.7 },
      }).addTo(map);
      routeLayers.push(bikeLine);
    }
  }

  // ── Display result cards ────────────────────────────
  function displayResults(result) {
    const section = document.getElementById('time-results');
    const grid    = document.getElementById('results-grid');
    if (!section || !grid) return;
    section.classList.remove('hidden');

    const times = [result.car.durationMin, result.scooter.durationMin, result.bike.durationMin, result.transit.durationMin];
    const maxTime = Math.max(...times);
    const minTime = Math.min(...times);

    const vehicles = [
      { key: 'car',     label: 'Car',                     icon: '🚗', cls: 'result-card--car' },
      { key: 'scooter', label: 'Scooter / Motorcycle',    icon: '🛵', cls: 'result-card--scooter' },
      { key: 'bike',    label: 'Bicycle',                  icon: '🚲', cls: 'result-card--bike' },
      { key: 'transit', label: 'Public Transport',         icon: '🚌', cls: 'result-card--transit' },
    ];

    grid.innerHTML = vehicles.map(v => {
      const r   = result[v.key];
      const pct = Math.round((r.durationMin / maxTime) * 100);
      const ext = extrapolate(r.durationMin);
      const isWinner  = r.durationMin === minTime;
      const isFaster  = !isWinner && r.durationMin < result.car.durationMin;
      const savingVsCar = result.car.durationMin - r.durationMin;

      let badge = '';
      if (isWinner) badge = `<div class="result-badge result-badge--winner">🏆 Fastest</div>`;
      else if (isFaster && v.key !== 'transit') badge = `<div class="result-badge result-badge--faster">⚡ ${fmtMins(savingVsCar)} faster than car</div>`;

      const fallbackNote = r.fallback ? ' <small style="font-size:11px;color:#9BA8C0">(estimated)</small>' : '';

      return `<div class="result-card ${v.cls} fade-in">
        <div class="result-vehicle-icon">${v.icon}</div>
        <div class="result-vehicle-name">${v.label}</div>
        ${badge}
        <div class="result-time">${fmtMins(r.durationMin)}</div>
        <div class="result-distance">${r.distanceKm.toFixed(1)} km${fallbackNote}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <ul class="result-extrap">
          <li><span>Per trip</span><strong>${fmtMins(ext.perTrip)}</strong></li>
          <li><span>Per week</span><strong>${fmtMins(ext.perWeek)}</strong></li>
          <li><span>Per year</span><strong>${fmtHours(ext.perYear)}</strong></li>
        </ul>
      </div>`;
    }).join('');

    if (window.triggerResultAnimations) window.triggerResultAnimations();
    updateExtrapolTable(result);
    updateRaceTrack(result);
    renderFootnotesForSection('footnotes-time', ['tomtom2023', 'inrix2023', 'ecf2022', 'acem2022']);
  }

  function updateExtrapolTable(result) {
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const pairs = [['car','car'],['sc','scooter'],['tr','transit'],['bk','bike']];
    pairs.forEach(([p, key]) => {
      const ext = extrapolate(result[key].durationMin);
      s(`ext-${p}-trip`, fmtMins(ext.perTrip));
      s(`ext-${p}-week`, fmtMins(ext.perWeek));
      s(`ext-${p}-year`, fmtHours(ext.perYear));
    });
  }

  function updateRaceTrack(result) {
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('race-time-car',     fmtMins(result.car.durationMin));
    s('race-time-scooter', fmtMins(result.scooter.durationMin));
    s('race-time-bike',    fmtMins(result.bike.durationMin));
    if (window.runVehicleRace) {
      window.runVehicleRace(result.car.durationMin, result.scooter.durationMin, result.bike.durationMin);
    }
  }

  // ── Sync time-value module ──────────────────────────
  function syncTimeValue(result) {
    const savingMin = result.car.durationMin - result.scooter.durationMin;
    const hoursWeek = Math.max((savingMin * 10) / 60, 0); // 10 trips/week
    window.lastSavingHoursWeek = hoursWeek;
    window.lastCarTimeYear     = Math.round(result.car.durationMin * 500 / 60);

    const rng  = document.getElementById('value-hours-range');
    const disp = document.getElementById('value-hours-display');
    const hint = document.getElementById('value-source-hint');
    if (rng && hoursWeek > 0) {
      const clamped = Math.min(Math.max(hoursWeek, 0.5), 20);
      rng.value = clamped.toFixed(1);
      if (disp) disp.textContent = clamped.toFixed(1).replace('.0','') + ' h/week';
      if (hint) hint.textContent = 'Auto-filled from your route (car vs scooter, 10 trips/week)';
    }
    if (window.computeTimeValue) window.computeTimeValue(hoursWeek);
  }

  // ── Challenge mini ──────────────────────────────────
  function computeChallengeMini() {
    const targetMin = parseInt(document.getElementById('challenge-minutes')?.value || 30, 10);
    const resultEl  = document.getElementById('challenge-mini-result');
    if (!resultEl) return;

    if (!lastResult) {
      resultEl.innerHTML = '<em>Calculate a route first to get a personalised result.</em>';
      resultEl.classList.add('has-result');
      return;
    }

    const scooterSaving = lastResult.car.durationMin - lastResult.scooter.durationMin;
    const bikeSaving    = lastResult.car.durationMin - lastResult.bike.durationMin;
    let html = '';

    if (scooterSaving >= targetMin) {
      html = `✅ <strong>Scooter/Motorcycle</strong> saves you <strong>${fmtMins(scooterSaving)}/trip</strong>. Goal reached daily!`;
    } else if (scooterSaving > 0) {
      const days = Math.ceil(targetMin / scooterSaving);
      html = `🛵 Scooter saves ${fmtMins(scooterSaving)}/trip. Ride it ${days}+ days/week to hit your ${targetMin}min goal.`;
    } else {
      html = `⚠️ On this route, scooter isn't faster (likely highway). Try a shorter route or peak-hour departure.`;
    }
    if (bikeSaving >= targetMin) html += `<br>🚲 <strong>Bicycle also hits your goal</strong>: saves ${fmtMins(bikeSaving)}/trip!`;

    resultEl.innerHTML = html;
    resultEl.classList.add('has-result');
  }

  // ── Footnotes ───────────────────────────────────────
  function renderFootnotesForSection(containerId, studyIds) {
    const container = document.getElementById(containerId);
    if (!container || !window.STUDIES) return;
    const html = studyIds.map((id, i) => {
      const s = window.STUDIES.find(x => x.id === id);
      if (!s) return '';
      return `<li><sup>${i+1}</sup> ${s.citation} — ${s.stat}. <a href="${s.url}" target="_blank" rel="noopener">Source ↗</a></li>`;
    }).filter(Boolean);
    container.innerHTML = html.length ? `<ol>${html.join('')}</ol>` : '';
  }
  window.renderFootnotesForSection = renderFootnotesForSection;

  // ── Helpers ─────────────────────────────────────────
  function fmtMins(m) {
    if (m < 60) return `${Math.round(m)} min`;
    const h = Math.floor(m / 60), mn = Math.round(m % 60);
    return mn > 0 ? `${h}h ${mn}m` : `${h}h`;
  }

  function fmtHours(m) {
    const h = m / 60;
    if (h < 1) return `${Math.round(m)} min`;
    return h < 10 ? `${h.toFixed(1).replace('.0','')}h` : `${Math.round(h)}h`;
  }

  function extrapolate(minPerTrip) {
    return { perTrip: minPerTrip, perWeek: minPerTrip * 10, perYear: minPerTrip * 500 };
  }

  function showLoading(on) {
    const el = document.getElementById('results-loading');
    if (!el) return;
    el.classList.toggle('hidden', !on);
    if (on) document.getElementById('time-results')?.classList.remove('hidden');
  }

  window.getLastRouteResult = () => lastResult;

  // ── Boot: wait for Leaflet ──────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForLeaflet(init));
  } else {
    waitForLeaflet(init);
  }

}());
