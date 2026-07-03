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

    // Render initial costs
    renderCostResults();
    bindModeToggle();
    bindAdvancedInputs();
    bindInlineVehiclePickers();
    initWizard();

    if (window.renderFootnotesForSection) {
      window.renderFootnotesForSection('footnotes-time',  ['tomtom2023', 'inrix2023', 'ecf2022', 'acem2022']);
      window.renderFootnotesForSection('footnotes-cost',  ['eea2023']);
      window.renderFootnotesForSection('footnotes-value', ['who2022', 'walker2017']);
    }
  }

  // ── Wizard navigation ────────────────────────────────
  // ── QUIZ WIZARD ──────────────────────────────────────
  function initWizard() {
    const V_LABELS = { car:'Car', scooter:'Scooter/Motorcycle', bike:'Bicycle', transit:'Public Transport', walk:'Walking' };
    const V_COLORS = { car:'var(--car-color)', scooter:'var(--scooter-color)', bike:'var(--bike-color)', transit:'var(--transit-color)', walk:'#E91E8C' };
    const V_ICONS  = { car:'🚗', scooter:'🛵', bike:'🚲', transit:'🚌', walk:'🚶' };

    function showQuiz(id) {
      ['quiz-q1','quiz-q2','quiz-q3','quiz-route','quiz-results'].forEach(s => {
        const el = document.getElementById(s);
        if (el) el.classList.toggle('hidden', s !== id);
      });
      document.getElementById(id)?.scrollIntoView({ behavior:'smooth', block:'start' });
    }

    // Q1 — current vehicle
    document.querySelectorAll('#q1-picker .quiz-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#q1-picker .quiz-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        window._challengeFrom = btn.dataset.vehicle;

        // Build Q2 picker — all except current
        const picker2 = document.getElementById('q2-picker');
        if (picker2) {
          const others = ['car','scooter','transit','bike','walk'].filter(v => v !== btn.dataset.vehicle);
          picker2.innerHTML = others.map(v => `
            <button class="quiz-btn" data-vehicle="${v}">
              <span>${V_ICONS[v]}</span>
              <strong>${V_LABELS[v]}</strong>
            </button>`).join('');
          picker2.querySelectorAll('.quiz-btn').forEach(b2 => {
            b2.addEventListener('click', () => {
              picker2.querySelectorAll('.quiz-btn').forEach(x => x.classList.remove('active'));
              b2.classList.add('active');
              window._challengeTo = b2.dataset.vehicle;
              showQuiz('quiz-q3');
            });
          });
        }
        showQuiz('quiz-q2');
      });
    });

    // Q2 back
    document.getElementById('q2-back')?.addEventListener('click', () => showQuiz('quiz-q1'));

    // Q3 — Simple or Advanced
    document.querySelectorAll('#q3-picker .quiz-btn--mode').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#q3-picker .quiz-btn--mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _mode = btn.dataset.mode;

        // Show/hide advanced emission profile
        const advEl = document.getElementById('advanced-extra');
        if (advEl) advEl.style.display = _mode === 'advanced' ? '' : 'none';

        // Update route header
        buildRouteHeader();
        showQuiz('quiz-route');
      });
    });

    // Q3 back
    document.getElementById('q3-back')?.addEventListener('click', () => showQuiz('quiz-q2'));

    // Route back
    document.getElementById('quiz-route-back')?.addEventListener('click', () => showQuiz('quiz-q3'));

    // Calculate
    document.getElementById('btn-step1-next')?.addEventListener('click', () => {
      const inpDist = document.getElementById('inp-distance');
      const inpDays = document.getElementById('inp-days');
      if (inpDist) state.distanceKm  = parseFloat(inpDist.value) || 15;
      if (inpDays) state.daysPerWeek = parseInt(inpDays.value)   || 5;
      const roadBtn = document.querySelector('.road-btn.active');
      if (roadBtn) state.roadType = roadBtn.dataset.road;

      const result = getTimeResult();
      window._lastTimeResult  = result;
      window._lastDaysPerWeek = state.daysPerWeek;

      buildResults(result, V_LABELS, V_COLORS, V_ICONS);
      syncDistanceToCost();
      syncSavingToValueModule(result);
      updateChallengeCounterFromResult(result);
      window.dispatchEvent(new CustomEvent('commute-calculated'));
      showQuiz('quiz-results');

      // Call after DOM is visible so GSAP/IDs work correctly
      setTimeout(() => {
        displayTimeResults(result);
        renderEmissionsPanel(result, state.distanceKm * ((DIST_FACTOR[state.roadType]||{}).car||1), state.roadType);
        if (window.runVehicleRace) {
          window.runVehicleRace(
            result.car.durationMin, result.scooter.durationMin,
            result.bike.durationMin, result.transit.durationMin, result.walk.durationMin
          );
        }
      }, 100);
    });

    // Start over
    document.getElementById('btn-step3-back')?.addEventListener('click', () => {
      window._challengeFrom = null;
      window._challengeTo   = null;
      showQuiz('quiz-q1');
    });

    // Show all toggle
    document.getElementById('wiz3-showall-btn')?.addEventListener('click', () => {
      const grid = document.getElementById('wiz3-all-grid');
      const btn  = document.getElementById('wiz3-showall-btn');
      if (!grid) return;
      const wasHidden = grid.classList.contains('hidden');
      grid.classList.toggle('hidden');
      btn.textContent = wasHidden ? '📊 Hide all vehicles' : '📊 Show all vehicles comparison';
      if (wasHidden && window.triggerResultAnimations) {
        setTimeout(window.triggerResultAnimations, 50);
      }
    });
  }

  function buildRouteHeader() {
    const el = document.getElementById('quiz-route-header');
    if (!el) return;
    const from = window._challengeFrom, to = window._challengeTo;
    const V_ICONS = { car:'🚗', scooter:'🛵', bike:'🚲', transit:'🚌', walk:'🚶' };
    const V_LABELS = { car:'Car', scooter:'Scooter/Moto', bike:'Bicycle', transit:'Transit', walk:'Walking' };
    const V_COLORS = { car:'var(--car-color)', scooter:'var(--scooter-color)', bike:'var(--bike-color)', transit:'var(--transit-color)', walk:'#E91E8C' };
    el.innerHTML = `
      <div class="quiz-route-summary">
        <span style="color:${V_COLORS[from]||'inherit'}">${V_ICONS[from]||''} ${V_LABELS[from]||''}</span>
        <span class="quiz-arrow">→</span>
        <span style="color:${V_COLORS[to]||'inherit'}">${V_ICONS[to]||''} ${V_LABELS[to]||''}</span>
        <span class="quiz-mode-badge">${_mode === 'advanced' ? '🔬 Advanced' : '⚡ Simple'}</span>
      </div>
      <p class="quiz-route-prompt">Now tell us about your route:</p>`;
  }

  function buildResults(result, V_LABELS, V_COLORS, V_ICONS) {
    const from = window._challengeFrom || 'car';
    const to   = window._challengeTo   || 'scooter';

    // Headline
    const headline = document.getElementById('wiz3-headline');
    if (headline) {
      const fColor = V_COLORS[from], tColor = V_COLORS[to];
      headline.innerHTML = `
        <div class="wiz3-headline-inner">
          <span class="quiz-badge" style="background:${fColor}18;color:${fColor};border:1.5px solid ${fColor}44">${V_ICONS[from]} ${V_LABELS[from]}</span>
          <span style="font-size:20px;color:var(--text-muted)">→</span>
          <span class="quiz-badge" style="background:${tColor}18;color:${tColor};border:1.5px solid ${tColor}44">${V_ICONS[to]} ${V_LABELS[to]}</span>
        </div>`;
    }

    // Comparison card
    updateStep3Verdict(result, from, to, V_LABELS, V_COLORS, V_ICONS);
    if (window.updateValueModuleForPair) window.updateValueModuleForPair(from, to);
    if (window.renderChallengeVerdict)   window.renderChallengeVerdict();
  }

  function showStep(stepId) {
    ['wiz-step1','wiz-step2','wiz-step3'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('hidden', id !== stepId);
    });
    document.getElementById(stepId)?.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function buildStep3(result, targetVehicle, V_LABELS, V_COLORS, V_ICONS) {
    // Headline
    const headline = document.getElementById('wiz3-headline');
    if (headline) {
      const color = V_COLORS[targetVehicle];
      headline.innerHTML = `
        <div class="wiz3-headline-inner">
          <span class="wiz3-from-badge" style="background:${color}18;color:${color};border:1.5px solid ${color}44">
            ${V_ICONS[targetVehicle]} ${V_LABELS[targetVehicle]}
          </span>
          <span class="wiz3-headline-text">Here's what <strong style="color:${color}">${V_LABELS[targetVehicle]}</strong> looks like for your commute:</span>
        </div>`;
    }

    // Main comparison: chosen vehicle vs car (universal reference)
    updateStep3Verdict(result, 'car', targetVehicle, V_LABELS, V_COLORS, V_ICONS);

    // Update value module
    window._challengeFrom = 'car';
    window._challengeTo   = targetVehicle;
    if (window.updateValueModuleForPair) window.updateValueModuleForPair('car', targetVehicle);
    if (window.renderChallengeVerdict) window.renderChallengeVerdict();
  }

  function updateStep3Verdict(result, from, to, V_LABELS, V_COLORS, V_ICONS) {
    const box = document.getElementById('wiz3-comparison');
    if (!box || !result[from] || !result[to]) return;

    const diffMin  = result[from].durationMin - result[to].durationMin;
    const days     = state.daysPerWeek;
    const annualH  = Math.round(diffMin * days * 2 * 50 / 60);
    const isGain   = diffMin > 0;
    const toColor  = V_COLORS[to];

    // Cost: compare from vs to specifically
    const costFrom   = computeMonthly(from).total;
    const costTo     = computeMonthly(to).total;
    const annualCostSaving = Math.round((costFrom - costTo) * 12);
    const costGain   = annualCostSaving > 0;
    const costLoss   = annualCostSaving < 0;

    const books    = Math.floor(Math.max(annualH, 0) / 5);
    const movies   = Math.floor(Math.max(annualH, 0) / 2);
    const gym      = Math.floor(Math.max(annualH, 0) / 0.75);

    // Store for share card
    window._lastCostData = { annual: Math.max(annualCostSaving, 0) };

    let html = `<div class="wiz3-verdict-card" style="border-color:${toColor}22">
      <div class="wiz3-verdict-title">
        ${V_ICONS[from]} <span style="color:var(--text-muted)">${V_LABELS[from]}</span>
        → ${V_ICONS[to]} <strong style="color:${toColor}">${V_LABELS[to]}</strong>
      </div>
      <div class="wiz3-stats-row">`;

    // Time
    if (isGain) {
      html += `<div class="wiz3-stat"><span style="color:${toColor}">+${fmtMins(diffMin)}</span><small>saved per trip</small></div>`;
      html += `<div class="wiz3-stat"><span style="color:${toColor}">+${annualH}h</span><small>per year</small></div>`;
    } else if (diffMin < 0) {
      html += `<div class="wiz3-stat"><span style="color:var(--car-color)">${fmtMins(Math.abs(diffMin))} more</span><small>per trip</small></div>`;
    } else {
      html += `<div class="wiz3-stat"><span style="color:var(--text-muted)">Same time</span><small>per trip</small></div>`;
    }

    // Cost — honest
    if (costGain) {
      html += `<div class="wiz3-stat"><span style="color:var(--bike-color)">+€${annualCostSaving}</span><small>saved/year</small></div>`;
    } else if (costLoss) {
      html += `<div class="wiz3-stat"><span style="color:var(--car-color)">−€${Math.abs(annualCostSaving)}</span><small>extra cost/year</small></div>`;
    } else {
      html += `<div class="wiz3-stat"><span style="color:var(--text-muted)">~Same cost</span><small>per year</small></div>`;
    }

    // Life gains (only if time saved)
    if (isGain) {
      if (books > 0)  html += `<div class="wiz3-stat"><span style="color:${toColor}">${books}</span><small>books/year</small></div>`;
      if (movies > 0) html += `<div class="wiz3-stat"><span style="color:${toColor}">${movies}</span><small>films/year</small></div>`;
      if (gym > 0)    html += `<div class="wiz3-stat"><span style="color:${toColor}">${gym}</span><small>gym sessions/year</small></div>`;
    }

    // Health for bike/walk
    if (to === 'bike' || to === 'walk') {
      html += `<div class="wiz3-stat"><span style="color:#E91E8C">−32%</span><small>mortality risk ❤️</small></div>`;
    }

    html += `</div>`;

    // Honest note if costs go up
    if (costLoss) {
      html += `<p class="wiz3-verdict-note">⚠️ ${V_LABELS[to]} costs €${Math.abs(annualCostSaving)} more per year than ${V_LABELS[from]}. ${isGain ? `But you gain ${annualH} hours/year back.` : ''}</p>`;
    }

    html += `<a href="#challenge" class="wiz3-share-cta">Generate my share card →</a></div>`;
    box.innerHTML = html;
  }
  let _mode = 'simple';
  const _adv = { body: 'medium', fuel: 'petrol', euro: 'euro6' };

  // ── Inline vehicle pickers (Module 1) ────────────────
  function bindInlineVehiclePickers() {
    // "I currently commute by" picker
    document.querySelectorAll('#current-vehicle-inline .chip--vehicle').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#current-vehicle-inline .chip--vehicle').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        window._challengeFrom = btn.dataset.vehicle;
        // Sync to Challenge Mode picker
        if (window.syncChallengePickers) window.syncChallengePickers();
        // Re-render if results exist
        if (window._lastTimeResult) {
          markCurrentVehicleCard();
          renderInlineVerdict();
          if (window.updateValueModuleForPair) {
            window.updateValueModuleForPair(window._challengeFrom, window._challengeTo || 'scooter');
          }
        }
      });
    });

    // "I want to switch to" picker
    document.querySelectorAll('#target-vehicle-inline .chip--vehicle').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#target-vehicle-inline .chip--vehicle').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        window._challengeTo = btn.dataset.vehicle;
        if (window.syncChallengePickers) window.syncChallengePickers();
        if (window._lastTimeResult) {
          renderInlineVerdict();
          if (window.updateValueModuleForPair) {
            window.updateValueModuleForPair(window._challengeFrom || 'car', window._challengeTo);
          }
        }
      });
    });
  }

  function markCurrentVehicleCard() {
    const from = window._challengeFrom || 'car';
    // Remove previous badge
    document.querySelectorAll('.you-are-here-badge').forEach(b => b.remove());
    document.querySelectorAll('.result-card').forEach(c => c.classList.remove('result-card--you-are-here'));
    // Find card for current vehicle and mark it
    const V_CLS = { car:'result-card--car', scooter:'result-card--scooter', transit:'result-card--transit', bike:'result-card--bike', walk:'result-card--walk' };
    const card = document.querySelector('.' + (V_CLS[from] || ''));
    if (card) {
      card.classList.add('result-card--you-are-here');
      const badge = document.createElement('div');
      badge.className = 'you-are-here-badge';
      badge.textContent = '← YOU';
      card.appendChild(badge);
    }
  }

  function renderInlineVerdict() {
    const box      = document.getElementById('inline-switch-box');
    const verdictEl = document.getElementById('isb-verdict');
    if (!box || !verdictEl) return;

    const r    = window._lastTimeResult;
    const from = window._challengeFrom || 'car';
    const to   = window._challengeTo   || 'scooter';

    box.classList.add('visible');

    if (!r || from === to) {
      verdictEl.className = 'isb-verdict neutral';
      verdictEl.textContent = from === to ? 'Pick a different vehicle to compare.' : 'Calculate your route first.';
      return;
    }

    const V_LABELS = { car:'Car', scooter:'Scooter/Motorcycle', bike:'Bicycle', transit:'Public Transport', walk:'Walking' };
    const days     = window._lastDaysPerWeek || 5;
    const diffMin  = r[from].durationMin - r[to].durationMin;
    const annualH  = Math.round(diffMin * days * 2 * 50 / 60);
    const isGain   = diffMin > 0;

    if (isGain) {
      const books  = Math.floor(Math.max(annualH, 0) / 5);
      const saving = window._lastCostData?.annual || 0;
      let html = `⚡ Switch from <strong>${V_LABELS[from]}</strong> to <strong>${V_LABELS[to]}</strong>: gain <strong>${fmtMins(diffMin)} per trip</strong> · <strong>${annualH}h/year</strong>`;
      if (saving > 0) html += ` · <strong>€${Math.round(saving)} saved/year</strong>`;
      if (books > 0)  html += ` · <strong>${books} extra books/year</strong>`;
      verdictEl.className = 'isb-verdict';
      verdictEl.innerHTML = html;
    } else if (diffMin < 0) {
      const lossMin = Math.abs(diffMin);
      verdictEl.className = 'isb-verdict loss';
      verdictEl.innerHTML = `⚠️ Switching from <strong>${V_LABELS[from]}</strong> to <strong>${V_LABELS[to]}</strong> costs you <strong>${fmtMins(lossMin)} more per trip</strong>.`;
    } else {
      verdictEl.className = 'isb-verdict neutral';
      verdictEl.textContent = `Similar travel time for both options on this road type.`;
    }
  }

  // Expose for share.js sync
  window.renderInlineVerdict = renderInlineVerdict;
  window.markCurrentVehicleCard = markCurrentVehicleCard;

  function bindModeToggle() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _mode = btn.dataset.mode;

        const simpleEl   = document.getElementById('simple-extra');
        const advancedEl = document.getElementById('advanced-extra');
        const hintEl     = document.getElementById('mode-hint');
        const emPanel    = document.getElementById('emissions-panel');

        if (_mode === 'simple') {
          if (simpleEl)   simpleEl.style.display   = '';
          if (advancedEl) advancedEl.style.display  = 'none';
          if (hintEl)     hintEl.textContent = 'Basic time & cost comparison';
          if (emPanel)    emPanel.classList.add('hidden');
        } else {
          if (simpleEl)   simpleEl.style.display   = 'none';
          if (advancedEl) advancedEl.style.display  = '';
          if (hintEl)     hintEl.textContent = 'Detailed emissions from EMEP/EEA 2024 official data';
        }
      });
    });
  }

  // ── Advanced input bindings ───────────────────────────
  function bindAdvancedInputs() {
    // Generic chip group handler
    function bindChips(groupId, stateKey) {
      document.querySelectorAll(`#${groupId} .chip`).forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll(`#${groupId} .chip`).forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          _adv[stateKey] = btn.dataset[stateKey] || btn.dataset.fuel || btn.dataset.euro || btn.dataset.body;
          // Update consumption unit if fuel changes
          if (stateKey === 'fuel') updateFuelUnits(_adv.fuel);
        });
      });
    }

    bindChips('body-picker', 'body');
    bindChips('fuel-picker', 'fuel');
    bindChips('euro-picker', 'euro');

    // Compact number inputs — advanced
    const pairs = [
      ['a-car-cons',   'carConsumption'],
      ['a-sc-cons',    'scooterConsumption'],
      ['a-fuel-price', 'fuelPrice'],
      ['a-transit-pass','transitMonthlyPass'],
    ];
    pairs.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => {
        state[key] = parseFloat(el.value) || state[key];
        renderCostResults();
      });
    });

    // Compact number inputs — simple
    const simplePairs = [
      ['s-car-cons',    'carConsumption'],
      ['s-sc-cons',     'scooterConsumption'],
      ['s-transit-pass','transitMonthlyPass'],
      ['s-fuel-price',  'fuelPrice'],
    ];
    simplePairs.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => {
        state[key] = parseFloat(el.value) || state[key];
        // Sync one-way → Module 2 (not reverse)
        syncToModule2(key, state[key]);
        renderCostResults();
      });
    });
  }

  // ── Sync one-way: Module 1 inputs → Module 2 sliders ─
  function syncToModule2(key, value) {
    const map = {
      carConsumption:    ['cost-car-cons-range',   'cost-car-cons-num'],
      scooterConsumption:['cost-sc-cons-range',     'cost-sc-cons-num'],
      transitMonthlyPass:['cost-transit-range',     'cost-transit-num'],
      fuelPrice:         ['cost-fuel-price-range',  'cost-fuel-price-num'],
      distanceKm:        ['cost-distance-range',    'cost-distance-num'],
      daysPerWeek:       ['cost-days-range',        'cost-days-num'],
    };
    const ids = map[key];
    if (!ids) return;
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });
  }

  function updateFuelUnits(fuel) {
    const consUnit  = document.getElementById('a-car-cons-unit');
    const priceUnit = document.getElementById('a-fuel-unit');
    const isElec    = fuel === 'electric' || fuel === 'phev_electric';
    if (consUnit)  consUnit.textContent  = isElec ? 'kWh/100km' : 'L/100km';
    if (priceUnit) priceUnit.textContent = isElec ? '€/kWh'     : '€/L';
  }

  // ── Emissions calculation (Advanced mode) ─────────────
  function calcEmissions(distKm, roadType, body, fuel, euro) {
    const ef = window.EMISSION_FACTORS;
    if (!ef) return null;
    const factors = ef[body]?.[fuel]?.[euro]?.[roadType];
    if (!factors) return null;

    const result = {};
    for (const [poll, gkm] of Object.entries(factors)) {
      result[poll] = gkm * distKm;
    }
    // CO2 from fuel consumption
    const CO2_PER_L = {
      petrol: 2392, diesel: 2640, lpg: 1611, cng: 1632,
      hybrid_petrol: 1800, phev_petrol: 1200, phev_diesel: 1400,
      electric: 0, phev_electric: 0, phev_diesel_elec: 0,
    };
    const cons    = parseFloat(document.getElementById('a-car-cons')?.value || state.carConsumption);
    const co2perL = CO2_PER_L[fuel] || 2392;
    result['CO2_kg'] = (cons / 100) * distKm * co2perL / 1000;
    return result;
  }

  // Scooter emissions: use L-Category data if available, else approximation
  const SCOOTER_EF = {
    // g/km at dense_city, city, mix, rural — approximation from EMEP L-Category averages
    dense_city: { CO2_kg_per_km: 0.085, NOx: 0.05,  PM_Exhaust: 0.0005 },
    city:       { CO2_kg_per_km: 0.075, NOx: 0.04,  PM_Exhaust: 0.0004 },
    mix:        { CO2_kg_per_km: 0.065, NOx: 0.025, PM_Exhaust: 0.0003 },
    rural:      { CO2_kg_per_km: 0.060, NOx: 0.020, PM_Exhaust: 0.0002 },
  };

  function calcScooterEmissions(distKm, roadType) {
    const ef = SCOOTER_EF[roadType] || SCOOTER_EF.city;
    const scCons = parseFloat(document.getElementById('a-sc-cons')?.value || state.scooterConsumption);
    return {
      CO2_kg:     (scCons / 100) * distKm * 2392 / 1000,
      NOx:        ef.NOx        * distKm,
      PM_Exhaust: ef.PM_Exhaust * distKm,
    };
  }

  function renderEmissionsPanel(result, distKm, roadType) {
    const panel = document.getElementById('emissions-panel');
    if (!panel || _mode !== 'advanced') { if (panel) panel.classList.add('hidden'); return; }

    const carEm = calcEmissions(distKm, roadType, _adv.body, _adv.fuel, _adv.euro);
    if (!carEm) {
      panel.innerHTML = `<p style="color:var(--text-muted);font-size:14px;padding:8px 0;">No emission data for this combination. Try a different fuel type or Euro standard.</p>`;
      panel.classList.remove('hidden');
      return;
    }

    // Switch vehicle from Challenge picker
    const switchTo   = window._challengeTo || 'scooter';
    const switchMeta = { car:'Car', scooter:'Scooter/Moto', bike:'Bicycle', transit:'Transit', walk:'Walking' };
    const switchIcon = { car:'🚗', scooter:'🛵', bike:'🚲', transit:'🚌', walk:'🚶' };

    // Emissions for target vehicle
    let targetCO2 = 0, targetNOx = 0, targetPM = 0;
    if (switchTo === 'scooter') {
      const sEm   = calcScooterEmissions(distKm, roadType);
      targetCO2   = sEm.CO2_kg;
      targetNOx   = sEm.NOx;
      targetPM    = sEm.PM_Exhaust;
    } else if (switchTo === 'bike' || switchTo === 'walk') {
      targetCO2 = targetNOx = targetPM = 0;
    } else if (switchTo === 'transit') {
      // Transit bus avg EU: ~40 g CO2eq/pkm (EEA 2023)
      targetCO2 = distKm * 0.040;
      targetNOx = distKm * 0.015;
      targetPM  = distKm * 0.0002;
    }

    const carCO2   = carEm.CO2_kg || 0;
    const carNOx   = carEm.NOx    || 0;
    const co2Save  = Math.max(carCO2 - targetCO2, 0);
    const noxSave  = Math.max(carNOx - targetNOx, 0);

    // Annual savings (round trip × days × 50 weeks)
    const tripsYear  = state.daysPerWeek * 2 * 50;
    const co2AnnKg   = co2Save * tripsYear;
    const noxAnnG    = noxSave * 1000 * tripsYear;

    // Comparison rows
    const rows = [
      { label: 'CO₂',         car: (carCO2*1000).toFixed(0)+'g',   target: (targetCO2*1000).toFixed(0)+'g',   unit: '/trip', save: co2Save > 0, annualSave: co2AnnKg.toFixed(1)+' kg/year' },
      { label: 'NOx',         car: (carNOx*1000).toFixed(2)+'mg', target: (targetNOx*1000).toFixed(2)+'mg', unit: '/trip', save: noxSave > 0, annualSave: noxAnnG.toFixed(1)+' g/year' },
      { label: 'PM (exhaust)',car: (carEm.PM_Exhaust||0)*1000*distKm < 1 ? ((carEm.PM_Exhaust||0)*1000*distKm).toFixed(3)+'mg' : ((carEm.PM_Exhaust||0)*1000*distKm).toFixed(1)+'mg', target: (targetPM*1000).toFixed(3)+'mg', unit: '/trip', save: true, annualSave: '' },
    ];

    const tableRows = rows.map(r => `
      <tr>
        <td>${r.label}</td>
        <td style="color:var(--car-color);font-weight:700;">${r.car}</td>
        <td style="color:${switchTo==='bike'||switchTo==='walk'?'var(--bike-color)':'var(--scooter-color)'};font-weight:700;">${r.target}</td>
        <td style="color:var(--bike-color);font-weight:600;">${r.save ? '−' + r.annualSave : '—'}</td>
      </tr>`).join('');

    // Urban vs rural NOx note
    const emUrban = window.EMISSION_FACTORS?.[_adv.body]?.[_adv.fuel]?.[_adv.euro]?.['dense_city'];
    const emRural = window.EMISSION_FACTORS?.[_adv.body]?.[_adv.fuel]?.[_adv.euro]?.['rural'];
    let urbanNote = '';
    if (emUrban?.NOx && emRural?.NOx) {
      const ratio = (emUrban.NOx / emRural.NOx).toFixed(1);
      urbanNote = `<div class="emissions-compare">At dense city speed (10 km/h), your ${_adv.fuel} car emits <strong>${ratio}× more NOx/km</strong> than at highway speed.${_adv.fuel==='diesel'?' Diesel engines are especially penalised at low speeds.':''}</div>`;
    }

    panel.innerHTML = `
      <h3>🌍 Emission comparison — your route (one way)</h3>
      <table class="em-compare-table">
        <thead><tr>
          <th>Pollutant</th>
          <th>🚗 Your car (${_adv.fuel} ${_adv.euro.replace('_',' ')})</th>
          <th>${switchIcon[switchTo]} ${switchMeta[switchTo]}</th>
          <th>Annual saving if you switch</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      ${urbanNote}
      <p style="font-size:11px;color:var(--text-light);margin-top:10px;">
        Source: EMEP/EEA Guidebook 2024 · Calculated at ${roadType.replace('_',' ')} effective speed · One-way trip only
      </p>`;
    panel.classList.remove('hidden');

    // Store for share card
    window._lastEmissions = { co2AnnKg, noxAnnG, switchTo, co2PerTrip: carCO2, targetCO2 };
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
    markCurrentVehicleCard();
    renderInlineVerdict();
    syncDistanceToCost();
    syncSavingToValueModule(result);
    updateChallengeCounterFromResult(result);
    renderEmissionsPanel(result, state.distanceKm * ((DIST_FACTOR[state.roadType]||{}).car||1), state.roadType);
    window.dispatchEvent(new CustomEvent('commute-calculated'));
  }

  // ── Display time result cards ─────────────────────────
  function displayTimeResults(result) {
    const grid = document.getElementById('results-grid');
    if (!grid) return;

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

    // NO animation here — cards may be in hidden container, GSAP would set opacity:0

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
    state.distanceKm = parseFloat(document.getElementById('inp-distance')?.value) || state.distanceKm;
    state.daysPerWeek = parseInt(document.getElementById('inp-days')?.value) || state.daysPerWeek;
    syncToModule2('distanceKm',  state.distanceKm);
    syncToModule2('daysPerWeek', state.daysPerWeek);
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
