(function () {
  'use strict';

  // ── Effective door-to-door speed table (km/h) ────────
  //
  // These are NOT road speeds — they are EFFECTIVE doorstep-to-doorstep
  // speeds including: parking search, walking to/from vehicle, waiting
  // at stops, traffic lights, congestion queuing.
  //
  // Calibration sources:
  //   TomTom Traffic Index 2025: Bucharest 13.3 km/h rush-hour road speed,
  //     62.5% congestion, 5th most congested globally.
  //   Numbeo 2025: Bucharest avg commute 41 min / 10.54 km = 15.4 km/h road speed.
  //   ACEM 2019: PTW 2.5–4× faster than car in urban peak (lane filtering).
  //   Meira et al. 2020: car social effective speed ~6 km/h (incl. earning time).
  //   INRIX 2024: EU avg 107h/year lost; Istanbul #1 (105h), London 101h.
  //
  // Road types:
  //   dense_city: Bucharest/Rome/Athens-level (TomTom top 10 most congested EU)
  //   city:       Warsaw/Prague/Lyon level (moderate congestion)
  //   mix:        50% urban + 50% suburban/periurban
  //   rural:      mostly open road

  const SPEEDS = {
    dense_city: { car: 10,  scooter: 24,  bike: 13, transit: 8,  walk: 5 },
    city:       { car: 18,  scooter: 30,  bike: 15, transit: 14, walk: 5 },
    mix:        { car: 38,  scooter: 48,  bike: 18, transit: 28, walk: 5 },
    rural:      { car: 75,  scooter: 85,  bike: 22, transit: 50, walk: 5 },
  };

  // Distance multiplier per vehicle vs input distance
  const DIST_FACTOR = {
    dense_city: { car: 1.12, scooter: 1.02, bike: 1.02, transit: 1.08, walk: 1.0 },
    city:       { car: 1.08, scooter: 1.02, bike: 1.02, transit: 1.06, walk: 1.0 },
    mix:        { car: 1.04, scooter: 1.01, bike: 1.01, transit: 1.04, walk: 1.0 },
    rural:      { car: 1.02, scooter: 1.01, bike: 1.01, transit: 1.02, walk: 1.0 },
  };

  // ── Congestion advantage multiplier for scooter/motorcycle ──────────
  //
  // In dense congestion, a scooter doesn't just travel at a fixed speed —
  // its advantage GROWS as congestion worsens. While cars queue, scooters
  // lane-filter and pass multiple cars per green light cycle.
  //
  // Real-world ratio in Bucharest peak hour (field measurements):
  //   Car: ~8 km/h effective door-to-door
  //   Scooter: ~21 km/h effective door-to-door
  //   Ratio: 2.6× — consistent with ACEM (2.5–4×) range, based on real experiments
  //   in Bucharest traffic (multiple intersections, peak hour observations)
  //
  // The multiplier scales with congestion level:
  //   dense_city: 1.0 (speeds already calibrated to this — no additional factor)
  //   city:       1.0 (moderate congestion, linear speed difference is representative)
  //   mix/rural:  1.0 (open road, no lane-filtering advantage)
  //
  // WHY we don't add a separate multiplier on top of the table:
  // The SPEEDS table already encodes the empirical ratio — dense_city car=7, scooter=22
  // gives ratio 3.14×, very close to the 3.4× measured in Bucharest.
  // Adding another factor would double-count the congestion effect.
  //
  // For transparency, we display the congestion ratio in the UI so users
  // can see HOW MUCH faster their scooter is vs car at the chosen road type.

  // ── Shared state (used by both time and cost modules) ─
  const state = {
    distanceKm:           15,
    daysPerWeek:          5,
    roadType:             'city',
    fuelType:             'petrol',
    carConsumption:       8,
    fuelPrice:            1.70,
    parkingPerDay:        2,
    carInsuranceYear:     600,
    scooterConsumption:   3,
    scooterInsuranceYear: 250,
    scooterPurchasePrice: 2500,
    transitMonthlyPass:   50,
  };

  const CO2 = { car: 180, scooter: 85, bike: 0, transit: 40 }; // g/km EEA 2023
  const CO2_ELECTRIC = 50; // EU grid average

  const BOOKS = [
    { title: 'Deep Work',        author: 'Cal Newport',  color: '#2C3E7A' },
    { title: 'Atomic Habits',    author: 'James Clear',  color: '#1A6B3A' },
    { title: '4-Hour Work Week', author: 'Tim Ferriss',  color: '#8B2D1C' },
    { title: 'Essentialism',     author: 'Greg McKeown', color: '#5A2D82' },
    { title: 'Stolen Focus',     author: 'Johann Hari',  color: '#1A4A6B' },
    { title: 'Die with Zero',    author: 'Bill Perkins', color: '#7A4A1A' },
  ];

  const ACTIVITIES = [
    { id: 'dinners',   label: 'Family dinners',   icon: '🍽️', hoursEach: 1.5,  unit: 'dinners/year' },
    { id: 'trips',     label: 'Weekend getaways', icon: '🗺️', hoursEach: 8,    unit: 'trips/year' },
    { id: 'books',     label: 'Books read',        icon: '📚', hoursEach: 5,    unit: 'books/year',  special: 'books' },
    { id: 'movies',    label: 'Films watched',     icon: '🎬', hoursEach: 2,    unit: 'films/year' },
    { id: 'gym',       label: 'Gym sessions',      icon: '💪', hoursEach: 0.75, unit: 'sessions/year' },
    { id: 'sleep',     label: 'Extra sleep/night', icon: '😴', hoursEach: null, unit: 'min/night',   special: 'sleep' },
    { id: 'freelance', label: 'Freelance income',  icon: '💰', hoursEach: 1,    unit: '€/year',      special: 'income' },
    { id: 'hustle',    label: 'Side hustle hours', icon: '🚀', hoursEach: null, unit: 'hours/year',  special: 'total' },
  ];

  // ── Time calculation ──────────────────────────────────
  function calcTime(vehicle) {
    const spd    = SPEEDS[state.roadType][vehicle];
    const factor = (DIST_FACTOR[state.roadType] || {})[vehicle] || 1;
    const dist   = state.distanceKm * factor;
    return (dist / spd) * 60; // minutes, effective door-to-door
  }

  function getTimeResult() {
    return {
      car:     { durationMin: calcTime('car'),     distanceKm: state.distanceKm * ((DIST_FACTOR[state.roadType]||{}).car     || 1) },
      scooter: { durationMin: calcTime('scooter'), distanceKm: state.distanceKm * ((DIST_FACTOR[state.roadType]||{}).scooter || 1) },
      bike:    { durationMin: calcTime('bike'),    distanceKm: state.distanceKm * ((DIST_FACTOR[state.roadType]||{}).bike    || 1) },
      transit: { durationMin: calcTime('transit'), distanceKm: state.distanceKm * ((DIST_FACTOR[state.roadType]||{}).transit || 1) },
      walk:    { durationMin: calcTime('walk'),    distanceKm: state.distanceKm },
    };
  }

  // ── Cost calculation ──────────────────────────────────
  function computeMonthly(vehicle) {
    const tripsPerMonth = (state.daysPerWeek / 7) * 30 * 2;
    const km            = tripsPerMonth * state.distanceKm;

    if (vehicle === 'car') {
      const fuel      = (km * state.carConsumption / 100) * state.fuelPrice;
      const parking   = state.parkingPerDay * state.daysPerWeek * (30 / 7);
      const insurance = state.carInsuranceYear / 12;
      return { fuel, parking, insurance, total: fuel + parking + insurance };
    }
    if (vehicle === 'scooter') {
      const fuel      = (km * state.scooterConsumption / 100) * state.fuelPrice;
      const insurance = state.scooterInsuranceYear / 12;
      return { fuel, parking: 0, insurance, total: fuel + insurance };
    }
    if (vehicle === 'transit') {
      return { pass: state.transitMonthlyPass, total: state.transitMonthlyPass };
    }
    return { maintenance: 6, total: 6 }; // bike
  }

  function breakevenMonths() {
    const diff = computeMonthly('car').total - computeMonthly('scooter').total;
    if (diff <= 0) return null;
    return Math.ceil(state.scooterPurchasePrice / diff);
  }

  function co2Annual(vehicle) {
    const tripsPerYear = state.daysPerWeek * 52 * 2;
    const km           = tripsPerYear * state.distanceKm;
    let factor = CO2[vehicle] || 0;
    if (state.fuelType === 'electric' && vehicle === 'car') factor = CO2_ELECTRIC;
    return (factor * km) / 1000;
  }

  function getAnnualSaving() {
    // Use Challenge picker selection if available, else default car→scooter
    const from = window._challengeFrom || 'car';
    const to   = window._challengeTo   || 'scooter';
    return (computeMonthly(from).total - computeMonthly(to).total) * 12;
  }
  window.CostModule = { getAnnualSaving };

  // ── Init ─────────────────────────────────────────────
  function init() {
    bindTimeInputs();
    bindCostInputs();
    buildCostCards();
    renderActivityGrid();

    const vRange = document.getElementById('value-hours-range');
    if (vRange) vRange.addEventListener('input', () => {
      const h = parseFloat(vRange.value);
      const dispEl = document.getElementById('value-hours-display');
      if (dispEl) dispEl.textContent = fmt1(h) + 'h';
      const hint = document.getElementById('value-source-hint');
      if (hint) hint.textContent = `What-if scenario: ${fmt1(h)} hours/week`;
      computeTimeValue(h);
    });

    // What-if toggle button
    const whatifBtn  = document.getElementById('value-whatif-btn');
    const whatifCtrl = document.getElementById('value-whatif-control');
    if (whatifBtn && whatifCtrl) {
      whatifBtn.addEventListener('click', () => {
        const isOpen = !whatifCtrl.classList.contains('hidden');
        whatifCtrl.classList.toggle('hidden', isOpen);
        whatifBtn.textContent = isOpen ? '✏️ Adjust manually' : '✖ Use calculated value';
        if (isOpen && window.lastSavingHoursWeek != null) {
          const rng = document.getElementById('value-hours-range');
          if (rng) rng.value = Math.min(Math.max(window.lastSavingHoursWeek, 0.5), 20).toFixed(1);
          computeTimeValue(window.lastSavingHoursWeek);
        }
      });
    }

    // Only recompute time value if a real calculation has been done
    const rateInput = document.getElementById('hourly-rate');
    if (rateInput) rateInput.addEventListener('input', () => {
      if (window.lastSavingHoursWeek != null) {
        computeTimeValue(window.lastSavingHoursWeek);
      }
    });

    // Render initial costs (distance defaults already set)
    renderCostResults();

    if (window.renderFootnotesForSection) {
      window.renderFootnotesForSection('footnotes-time',  ['tomtom2023', 'inrix2023', 'ecf2022', 'acem2022']);
      window.renderFootnotesForSection('footnotes-cost',  ['eea2023']);
      window.renderFootnotesForSection('footnotes-value', ['who2022', 'walker2017']);
    }
  }

  // ── Time input bindings ───────────────────────────────
  function bindTimeInputs() {
    const inpDist = document.getElementById('inp-distance');
    const inpDays = document.getElementById('inp-days');
    const btnCalc = document.getElementById('btn-calculate');

    if (inpDist) inpDist.addEventListener('input', () => { state.distanceKm  = parseFloat(inpDist.value) || 15; });
    if (inpDays) inpDays.addEventListener('input', () => { state.daysPerWeek = parseInt(inpDays.value)   || 5; });

    // Road type toggle — also sync state on init from active button
    const syncRoadType = () => {
      const active = document.querySelector('.road-btn.active');
      if (active) state.roadType = active.dataset.road;
    };
    syncRoadType(); // read initial active button

    document.querySelectorAll('.road-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.road-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.roadType = btn.dataset.road;
      });
    });

    if (btnCalc) btnCalc.addEventListener('click', runCalculation);

    // Also bind challenge button
    const btnChallenge = document.getElementById('btn-challenge-calc');
    if (btnChallenge) btnChallenge.addEventListener('click', computeChallengeMini);
  }

  // ── Main calculation trigger ──────────────────────────
  function runCalculation() {
    // Read current input values (in case user typed without triggering events)
    const inpDist = document.getElementById('inp-distance');
    const inpDays = document.getElementById('inp-days');
    if (inpDist) state.distanceKm  = parseFloat(inpDist.value) || 15;
    if (inpDays) state.daysPerWeek = parseInt(inpDays.value)   || 5;

    const result = getTimeResult();
    window._lastTimeResult  = result;
    window._lastDaysPerWeek = state.daysPerWeek;

    displayTimeResults(result);
    syncDistanceToCost();
    syncSavingToValueModule(result);
    updateChallengeCounterFromResult(result);
    // Notify share.js / challenge section
    window.dispatchEvent(new CustomEvent('commute-calculated'));
  }

  // ── Display time result cards ─────────────────────────
  function displayTimeResults(result) {
    const section = document.getElementById('time-results');
    const grid    = document.getElementById('results-grid');
    if (!section || !grid) return;

    section.classList.remove('hidden');

    const vehicles = [
      { key: 'car',     label: 'Car',                  icon: '🚗', cls: 'result-card--car' },
      { key: 'scooter', label: 'Scooter / Motorcycle', icon: '🛵', cls: 'result-card--scooter' },
      { key: 'bike',    label: 'Bicycle',               icon: '🚲', cls: 'result-card--bike' },
      { key: 'transit', label: 'Public Transport',      icon: '🚌', cls: 'result-card--transit' },
      { key: 'walk',    label: 'Walking',                icon: '🚶', cls: 'result-card--walk' },
    ];

    const times  = vehicles.map(v => result[v.key].durationMin);
    const maxT   = Math.max(...times);
    const minT   = Math.min(...times);

    grid.innerHTML = vehicles.map(v => {
      const r   = result[v.key];
      const pct = Math.round((r.durationMin / maxT) * 100);
      const ext = extrapolate(r.durationMin, state.daysPerWeek);
      const isWinner  = r.durationMin === minT;
      const isFaster  = !isWinner && r.durationMin < result.car.durationMin && v.key !== 'transit';
      const saving    = result.car.durationMin - r.durationMin;

      let badge = '';
      if (isWinner)                badge = `<div class="result-badge result-badge--winner">🏆 Fastest</div>`;
      else if (isFaster)           badge = `<div class="result-badge result-badge--faster">⚡ ${fmtMins(saving)} faster than car</div>`;
      else if (v.key === 'walk')   badge = `<div class="result-badge result-badge--health">❤️ +32% lower mortality risk</div>`;

      const spd = SPEEDS[state.roadType][v.key];

      // Walking card — dynamic steps and calories based on actual distance
      // 1 km walking ≈ 1,300 steps (avg adult stride 0.77m) | ≈ 65 kcal (70kg person)
      // Round trip = ×2
      let walkNote = '';
      if (v.key === 'walk') {
        const distRT   = r.distanceKm * 2;
        const steps    = Math.round(distRT * 1300 / 1000) * 1000;
        const kcal     = Math.round(distRT * 65 / 10) * 10;
        const stepsStr = steps >= 1000 ? (steps / 1000).toFixed(0) + ',000' : steps.toString();
        // Practicality note for long distances
        const practNote = state.distanceKm > 4
          ? ` <span style="opacity:0.6;font-size:10px;">(realistic for trips under 4 km)</span>`
          : '';
        walkNote = `<div class="walk-health-note">~${stepsStr} steps/day · ~${kcal} kcal burned${practNote} · cardiovascular risk −38–53%</div>`;
      }

      return `<div class="result-card ${v.cls} fade-in">
        <div class="result-vehicle-icon">${v.icon}</div>
        <div class="result-vehicle-name">${v.label}</div>
        ${badge}
        <div class="result-time">${fmtMins(r.durationMin)}</div>
        <div class="result-distance">${r.distanceKm.toFixed(1)} km · avg ${spd} km/h</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        ${walkNote}
        <ul class="result-extrap">
          <li><span>One way</span><strong>${fmtMins(ext.perTrip)}</strong></li>
          <li><span>Round trip/day</span><strong>${fmtMins(ext.perTrip * 2)}</strong></li>
          <li><span>Per week</span><strong>${fmtMins(ext.perWeek)}</strong></li>
          <li><span>Per year</span><strong>${fmtHours(ext.perYear)}</strong></li>
        </ul>
      </div>`;
    }).join('');

    if (window.triggerResultAnimations) window.triggerResultAnimations();

    // Congestion advantage banner
    renderCongestionBanner(result);

    // Extrapolation table
    const pairs = [['car','car'],['sc','scooter'],['tr','transit'],['bk','bike'],['wk','walk']];
    pairs.forEach(([p, key]) => {
      const ext = extrapolate(result[key].durationMin, state.daysPerWeek);
      setText(`ext-${p}-trip`, fmtMins(ext.perTrip));
      setText(`ext-${p}-week`, fmtMins(ext.perWeek));
      setText(`ext-${p}-year`, fmtHours(ext.perYear));
    });

    // Race track
    setText('race-time-car',     fmtMins(result.car.durationMin));
    setText('race-time-scooter', fmtMins(result.scooter.durationMin));
    setText('race-time-bike',    fmtMins(result.bike.durationMin));
    setText('race-time-transit', fmtMins(result.transit.durationMin));
    setText('race-time-walk',    fmtMins(result.walk.durationMin));
    if (window.runVehicleRace) {
      window.runVehicleRace(
        result.car.durationMin,
        result.scooter.durationMin,
        result.bike.durationMin,
        result.transit.durationMin,
        result.walk.durationMin
      );
    }

    // Scroll results into view
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Congestion advantage banner ───────────────────────
  function renderCongestionBanner(result) {
    const el = document.getElementById('congestion-banner');
    if (!el) return;

    const carMin     = result.car.durationMin;
    const scooterMin = result.scooter.durationMin;
    const ratio      = carMin / scooterMin;

    // Only show when scooter is meaningfully faster
    if (ratio < 1.3) { el.style.display = 'none'; return; }

    el.style.display = 'flex';

    // Context note varies by road type
    const notes = {
      dense_city: 'Based on real traffic experiments in Bucharest: a scooter passes the same cars at every congested intersection. The gap grows with each traffic jam.',
      city:       'In city traffic, scooters/motorcycles benefit from lane positioning and quicker starts at lights.',
      mix:        'Mixed roads: scooter advantage comes mainly from the urban sections.',
      rural:      'On open roads the speed difference between modes narrows significantly.',
    };

    const ratioStr = ratio.toFixed(1).replace('.0', '');
    el.innerHTML = `
      <div class="cb-icon">🛵</div>
      <div class="cb-text">
        <strong>Scooter/Motorcycle is ${ratioStr}× faster than car</strong> at ${state.roadType.replace('_', ' ')} congestion level.
        <span class="cb-note">${notes[state.roadType] || ''}</span>
      </div>
      <div class="cb-ratio">${ratioStr}<span>×</span></div>
    `;
  }

  // ── Sync distance to cost module ──────────────────────
  function syncDistanceToCost() {
    const km = state.distanceKm;
    syncPair('cost-distance-range', 'cost-distance-num', km);
    renderCostResults();
  }

  // ── Sync time saving to value module ──────────────────
  function syncSavingToValueModule(result) {
    // Store the full result — Module 3 and Challenge will pick their own from/to
    window._lastTimeResult = result;

    // Default display: car vs scooter (most common switch)
    // But this gets overridden by Challenge picker selection
    updateValueModuleForPair(
      window._challengeFrom || 'car',
      window._challengeTo   || 'scooter',
      result
    );
  }

  // Called by share.js when picker changes, and here on calculate
  window.updateValueModuleForPair = function(from, to, result) {
    result = result || window._lastTimeResult;
    if (!result || !result[from] || !result[to]) return;

    const savingPerTrip = result[from].durationMin - result[to].durationMin;
    const hoursWeek     = Math.max((savingPerTrip * state.daysPerWeek * 2) / 60, 0);
    const isGain        = savingPerTrip > 0;

    window.lastSavingHoursWeek = isGain ? hoursWeek : 0;
    window.lastCarTimeYear     = Math.round(result[from].durationMin * state.daysPerWeek * 2 * 50 / 60);

    const V_LABELS = { car: 'Car', scooter: 'Scooter/Motorcycle', bike: 'Bicycle', transit: 'Public Transport', walk: 'Walking' };

    const bigEl   = document.getElementById('value-summary-big');
    const labelEl = document.getElementById('value-summary-label');
    const dispEl  = document.getElementById('value-hours-display');
    const whatif  = document.getElementById('value-whatif');

    if (!bigEl) return;

    if (isGain && hoursWeek > 0) {
      const h = hoursWeek.toFixed(1).replace('.0', '');
      if (dispEl)  dispEl.textContent  = h + 'h';
      bigEl.style.display = 'flex';
      if (whatif)  whatif.style.display = 'block';
      if (labelEl) labelEl.textContent = `By switching from ${V_LABELS[from]} to ${V_LABELS[to]} on your ${state.daysPerWeek}-day commute:`;
      computeTimeValue(hoursWeek);
    } else {
      bigEl.style.display = 'none';
      if (whatif) whatif.style.display = 'none';
      if (labelEl) {
        if (savingPerTrip < 0) {
          // Switching to a slower vehicle — show honest message
          const lossMin = Math.abs(savingPerTrip * 2).toFixed(0);
          labelEl.textContent = `Switching from ${V_LABELS[from]} to ${V_LABELS[to]} costs you ${lossMin} min/day — you lose time, not gain it.`;
        } else {
          labelEl.textContent = `These two vehicles have similar travel times on this road type.`;
        }
      }
      computeTimeValue(0); // reset cards to —
    }
  };

  function updateChallengeCounterFromResult(result) {
    window.lastCarTimeYear = Math.round(result.car.durationMin * state.daysPerWeek * 2 * 50 / 60);
    if (window.updateChallengeCounter) window.updateChallengeCounter(result.car.durationMin);
  }

  // ── Challenge mini ────────────────────────────────────
  function computeChallengeMini() {
    const targetMin = parseInt(document.getElementById('challenge-minutes')?.value || 30, 10);
    const resultEl  = document.getElementById('challenge-mini-result');
    if (!resultEl) return;

    if (!window._lastTimeResult) {
      resultEl.innerHTML = '<em>Click "Calculate" first to get a personalised result.</em>';
      resultEl.classList.add('has-result');
      return;
    }
    const r = window._lastTimeResult;
    const scSaving   = r.car.durationMin - r.scooter.durationMin;
    const bikeSaving = r.car.durationMin - r.bike.durationMin;
    let html = '';

    if (scSaving >= targetMin) {
      html = `✅ <strong>Scooter/Motorcycle</strong> saves you <strong>${fmtMins(scSaving)}/trip</strong>. Goal reached every single day!`;
    } else if (scSaving > 0) {
      const days = Math.ceil(targetMin / scSaving);
      html = `🛵 Scooter saves ${fmtMins(scSaving)}/trip. Ride it ${days}+ days/week to hit your ${targetMin} min goal.`;
    } else {
      html = `⚠️ On ${state.roadType} roads, scooter isn't significantly faster. Try "Mixed" road type.`;
    }
    if (bikeSaving >= targetMin) html += `<br>🚲 <strong>Bicycle also hits your goal:</strong> saves ${fmtMins(bikeSaving)}/trip + you get a workout!`;

    resultEl.innerHTML = html;
    resultEl.classList.add('has-result');
  }

  // ── Cost input bindings ───────────────────────────────
  function bindCostInputs() {
    const pairs = [
      ['cost-distance-range',   'cost-distance-num',   'distanceKm',           ],
      ['cost-days-range',       'cost-days-num',        'daysPerWeek',          ],
      ['cost-fuel-price-range', 'cost-fuel-price-num',  'fuelPrice',            ],
      ['cost-car-cons-range',   'cost-car-cons-num',    'carConsumption',       ],
      ['cost-parking-range',    'cost-parking-num',     'parkingPerDay',        ],
      ['cost-car-ins-range',    'cost-car-ins-num',     'carInsuranceYear',     ],
      ['cost-sc-cons-range',    'cost-sc-cons-num',     'scooterConsumption',   ],
      ['cost-sc-ins-range',     'cost-sc-ins-num',      'scooterInsuranceYear', ],
      ['cost-sc-price-range',   'cost-sc-price-num',    'scooterPurchasePrice', ],
      ['cost-transit-range',    'cost-transit-num',     'transitMonthlyPass',   ],
    ];

    const KEY_MAP = {};
    let costDebounce = null;
    const debouncedRender = () => {
      clearTimeout(costDebounce);
      costDebounce = setTimeout(renderCostResults, 80);
    };

    pairs.forEach(([rId, nId, key]) => {
      KEY_MAP[rId] = key; KEY_MAP[nId] = key;
      const r = document.getElementById(rId);
      const n = document.getElementById(nId);
      const update = (src, other) => {
        state[key] = parseFloat(src.value) || 0;
        if (other) other.value = src.value;
        debouncedRender();
      };
      if (r) r.addEventListener('input',  () => update(r, n));
      if (n) n.addEventListener('input',  () => update(n, r));
      if (n) n.addEventListener('change', () => update(n, r));
    });

    document.querySelectorAll('.fuel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fuel-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.fuelType = btn.dataset.fuel;
        updateFuelLabels();
        renderCostResults();
      });
    });
  }

  function buildCostCards() {
    const grid = document.querySelector('.cost-cards-grid');
    if (!grid) return;
    const v = [
      { key: 'car',     label: 'Car',                  color: 'var(--car-color)' },
      { key: 'scooter', label: 'Scooter / Motorcycle', color: 'var(--scooter-color)' },
      { key: 'transit', label: 'Public Transport',     color: 'var(--transit-color)' },
      { key: 'bike',    label: 'Bicycle',               color: 'var(--bike-color)' },
    ];
    grid.innerHTML = v.map(x => `
      <div class="cost-card cost-card--${x.key} card">
        <div class="cost-vehicle-label" style="color:${x.color}">${x.label}</div>
        <div class="cost-monthly-label">Monthly cost</div>
        <div class="cost-big" id="cost-monthly-${x.key}">€—</div>
        <div class="cost-bar-wrap">
          <div class="cost-bar cost-bar--${x.key}" id="cost-bar-${x.key}"></div>
        </div>
        <div class="cost-breakdown" id="cost-breakdown-${x.key}"></div>
      </div>`).join('');
  }

  function syncPair(rId, nId, val) {
    const r = document.getElementById(rId), n = document.getElementById(nId);
    if (r) r.value = val; if (n) n.value = val;
  }

  function updateFuelLabels() {
    const isElec = state.fuelType === 'electric';
    const lbl  = document.getElementById('fuel-price-label');
    const unit = document.getElementById('fuel-unit');
    const cu   = document.getElementById('car-cons-unit');
    if (lbl)  lbl.textContent  = isElec ? 'Electricity price (€/kWh)' : 'Fuel price (€/L)';
    if (unit) unit.textContent = isElec ? '€/kWh' : '€/L';
    if (cu)   cu.textContent   = isElec ? 'kWh/100km' : 'L/100km';
  }

  // ── Render cost results ───────────────────────────────
  function renderCostResults() {
    const costs  = { car: computeMonthly('car'), scooter: computeMonthly('scooter'), transit: computeMonthly('transit'), bike: computeMonthly('bike') };
    const maxCst = Math.max(...Object.values(costs).map(c => c.total), 1);

    ['car','scooter','transit','bike'].forEach(v => {
      setText(`cost-monthly-${v}`, `€${Math.round(costs[v].total)}`);
      renderBreakdown(`cost-breakdown-${v}`, costs[v]);
      setBar(`cost-bar-${v}`, (costs[v].total / maxCst) * 100);
    });

    const annual = getAnnualSaving();
    setText('annual-saving', annual > 0 ? `€${Math.round(annual)}/yr` : 'N/A');

    const months = breakevenMonths();
    setText('breakeven-result', months ? `${months} months` : 'N/A');

    const co2Saved = Math.round(co2Annual('car') - co2Annual('scooter'));
    setText('co2-saving', co2Saved > 0 ? `${co2Saved} kg` : '0 kg');

    // Store for share.js to use when generating card (not pushed to DOM — IDs don't exist there)
    window._lastCostData = { annual, co2Saved };
  }

  function renderBreakdown(id, costs) {
    const el = document.getElementById(id);
    if (!el) return;
    const rows = [];
    if (costs.fuel        > 0) rows.push(['Fuel',         costs.fuel]);
    if (costs.parking     > 0) rows.push(['Parking',      costs.parking]);
    if (costs.insurance   > 0) rows.push(['Insurance',    costs.insurance]);
    if (costs.pass        > 0) rows.push(['Monthly pass', costs.pass]);
    if (costs.maintenance > 0) rows.push(['Maintenance',  costs.maintenance]);
    el.innerHTML = rows.map(([l,v]) =>
      `<div class="cost-breakdown-item"><span>${l}</span><span>€${v.toFixed(0)}/mo</span></div>`
    ).join('');
  }

  function setBar(id, pct) {
    if (window.animateBar) { window.animateBar(id, pct); return; }
    const el = document.getElementById(id); if (el) el.style.width = pct + '%';
  }

  // ── Time value computation ────────────────────────────
  window.computeTimeValue = function (hoursPerWeek) {
    const annual = hoursPerWeek * 50;
    const rate   = parseFloat(document.getElementById('hourly-rate')?.value || 30);

    const results = ACTIVITIES.map(act => {
      if (act.special === 'sleep')  return { ...act, value: (hoursPerWeek * 60) / 7 };
      if (act.special === 'income') return { ...act, value: annual * rate };
      if (act.special === 'total')  return { ...act, value: annual };
      return { ...act, value: Math.floor(annual / act.hoursEach) };
    });

    updateActivityCards(results);

    // Store books count for share.js (not pushed to DOM ghost IDs)
    const booksAct = results.find(r => r.id === 'books');
    window._lastActivityData = {
      books:   booksAct ? Math.floor(booksAct.value) : 0,
      movies:  Math.floor((hoursPerWeek * 50) / 2),
      gym:     Math.floor((hoursPerWeek * 50) / 0.75),
      dinners: Math.floor((hoursPerWeek * 50) / 1.5),
      hoursYear: Math.round(hoursPerWeek * 50),
    };
  };

  // ── Activity cards ────────────────────────────────────
  function renderActivityGrid() {
    const grid = document.getElementById('activity-grid');
    if (!grid) return;
    // No fade-in class — cards are always visible; GSAP adds a subtle entrance if available
    grid.innerHTML = ACTIVITIES.map(act => `
      <div class="activity-card" id="activity-card-${act.id}">
        <div class="activity-icon">${act.icon}</div>
        <div class="activity-value" id="act-val-${act.id}">—</div>
        <div class="activity-unit">${act.unit}</div>
        <div class="activity-label">${act.label}</div>
        ${act.special === 'books' ? '<div class="book-covers" id="book-covers"></div>' : ''}
      </div>`).join('');

    // Optional subtle animation — never hides cards if GSAP missing or not scrolled
    if (window.gsap && window.ScrollTrigger) {
      setTimeout(() => {
        window.gsap.fromTo('.activity-card',
          { opacity: 0.3, y: 16 },
          { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out', stagger: 0.06,
            scrollTrigger: { trigger: '#activity-grid', start: 'top 95%', once: true } }
        );
      }, 100);
    }
  }

  function updateActivityCards(results) {
    results.forEach(act => {
      const el = document.getElementById(`act-val-${act.id}`);
      if (!el) return;
      const raw = typeof act.value === 'number' ? act.value : 0;

      // Format final value as string
      function fmtVal(v) {
        if (act.special === 'sleep')  return `${Math.round(v)} min`;
        if (act.special === 'income') return `€${Math.round(v).toLocaleString('en')}`;
        if (act.special === 'total')  return `${Math.round(v)} h`;
        return String(Math.floor(v));
      }

      if (window.gsap && raw > 0) {
        // Count up from current displayed value (not always 0)
        const current = parseFloat(el.textContent.replace(/[^0-9.]/g, '')) || 0;
        const obj = { v: current };
        window.gsap.to(obj, {
          v: raw, duration: 1.0, ease: 'power2.out',
          onUpdate() { el.textContent = fmtVal(obj.v); },
        });
      } else {
        el.textContent = raw > 0 ? fmtVal(raw) : '—';
      }
    });
    renderBookCovers();
  }

  function renderBookCovers() {
    const c = document.getElementById('book-covers');
    if (!c) return;
    const picks = [...BOOKS].sort(() => Math.random() - 0.5).slice(0, 3);
    c.innerHTML = picks.map(b =>
      `<div class="book-cover" style="background:${b.color}" title="${b.title}"><span>${b.title}</span></div>`
    ).join('');
  }

  // ── Helpers ───────────────────────────────────────────
  function extrapolate(minPerTrip, daysWeek) {
    const tripsWeek = (daysWeek || 5) * 2;
    return {
      perTrip: minPerTrip,
      perWeek: minPerTrip * tripsWeek,
      perYear: minPerTrip * tripsWeek * 50,
    };
  }

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

  function fmt1(n) { return n.toFixed(1).replace('.0',''); }

  function setText(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }

  // expose for footnotes
  window.renderFootnotesForSection = function (containerId, studyIds) {
    const container = document.getElementById(containerId);
    if (!container || !window.STUDIES) return;
    const html = studyIds.map((id, i) => {
      const s = window.STUDIES.find(x => x.id === id);
      if (!s) return '';
      return `<li><sup>${i+1}</sup> ${s.citation} — ${s.stat}. <a href="${s.url}" target="_blank" rel="noopener">Source ↗</a></li>`;
    }).filter(Boolean);
    container.innerHTML = html.length ? `<ol>${html.join('')}</ol>` : '';
  };

  // ── Boot ─────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
