(function () {
  'use strict';

  // ── Vehicle metadata ──────────────────────────────────
  const V_META = {
    car:     { label: 'Car',              icon: '🚗', color: '#E05A3A' },
    scooter: { label: 'Scooter/Moto',     icon: '🛵', color: '#4F8EF7' },
    transit: { label: 'Public Transport', icon: '🚌', color: '#F5A623' },
    bike:    { label: 'Bicycle',          icon: '🚲', color: '#3EC278' },
  };

  // State: what the user currently uses and what they want to switch to
  const challenge = {
    currentVehicle: 'car',
    targetVehicle:  'scooter',
  };

  // ── Init ─────────────────────────────────────────────
  function init() {
    bindVehiclePickers();
    bindGenerateBtn();
    renderChallengeVerdict();
    // Re-render verdict whenever route is calculated
    window.addEventListener('commute-calculated', renderChallengeVerdict);
  }

  // ── Vehicle pickers ───────────────────────────────────
  function bindVehiclePickers() {
    const currentPicker = document.getElementById('current-vehicle-picker');
    const targetPicker  = document.getElementById('target-vehicle-picker');

    if (currentPicker) {
      currentPicker.querySelectorAll('.vpick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          currentPicker.querySelectorAll('.vpick-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          challenge.currentVehicle = btn.dataset.vehicle;
          window._challengeFrom = challenge.currentVehicle;
          renderChallengeVerdict();
          if (window.updateValueModuleForPair) window.updateValueModuleForPair(challenge.currentVehicle, challenge.targetVehicle);
        });
      });
    }

    if (targetPicker) {
      targetPicker.querySelectorAll('.vpick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          targetPicker.querySelectorAll('.vpick-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          challenge.targetVehicle = btn.dataset.vehicle;
          window._challengeTo = challenge.targetVehicle;
          renderChallengeVerdict();
          if (window.updateValueModuleForPair) window.updateValueModuleForPair(challenge.currentVehicle, challenge.targetVehicle);
        });
      });
    }
  }

  // ── Render challenge verdict ──────────────────────────
  function renderChallengeVerdict() {
    const r = window._lastTimeResult;

    // Update dramatic counter with current vehicle's time
    updateDramaticCounter(r);

    const verdictEl = document.getElementById('challenge-switch-verdict');
    if (!verdictEl) return;

    if (!r) {
      verdictEl.innerHTML = `<p style="color:rgba(255,255,255,0.5);font-size:15px;text-align:center;padding:8px 0;">Calculate your route in Module 1 to see your personalised result.</p>`;
      return;
    }

    const from = challenge.currentVehicle;
    const to   = challenge.targetVehicle;

    if (from === to) {
      verdictEl.innerHTML = `<p style="color:rgba(255,255,255,0.6);font-size:15px;text-align:center;">Pick two different vehicles to compare.</p>`;
      return;
    }

    const fromMin   = r[from].durationMin;
    const toMin     = r[to].durationMin;
    const diffMin   = fromMin - toMin;  // positive = target is faster
    const daysWeek  = window._lastDaysPerWeek || 5;
    const diffWeek  = diffMin * daysWeek * 2;   // round trips
    const diffYear  = diffWeek * 50;             // hours/year
    const diffHY    = diffYear / 60;

    const fromMeta  = V_META[from];
    const toMeta    = V_META[to];

    // Annual hours (positive = gain, negative = loss)
    const annualH   = diffHY;
    const weeksGain = annualH / 50;

    // Life equivalents (using per-week saving)
    const booksYear   = Math.floor((annualH) / 5);
    const moviesYear  = Math.floor((annualH) / 2);
    const gymYear     = Math.floor((annualH) / 0.75);
    const dinnersYear = Math.floor((annualH) / 1.5);

    // Cost saving from calculators
    const annualSaving = window.CostModule ? window.CostModule.getAnnualSaving() : 0;

    if (diffMin > 0) {
      // Target is faster — positive message
      verdictEl.innerHTML = `
        <div class="cv-header">
          <span class="cv-badge" style="background:${fromMeta.color}22;color:${fromMeta.color}">${fromMeta.icon} ${fromMeta.label}</span>
          <span class="cv-arrow">→</span>
          <span class="cv-badge" style="background:${toMeta.color}22;color:${toMeta.color}">${toMeta.icon} ${toMeta.label}</span>
        </div>
        <div class="cv-win-line">
          You gain <strong style="color:${toMeta.color}">${Math.round(diffMin)} min</strong> every single trip.
        </div>
        <div class="cv-stats-grid">
          <div class="cv-stat"><span style="color:${toMeta.color}">${Math.round(diffWeek / 60 * 10) / 10}h</span><small>saved/week</small></div>
          <div class="cv-stat"><span style="color:${toMeta.color}">${Math.round(annualH)}h</span><small>reclaimed/year</small></div>
          ${annualSaving > 0 ? `<div class="cv-stat"><span style="color:#3EC278">€${Math.round(annualSaving)}</span><small>saved/year</small></div>` : ''}
        </div>
        <div class="cv-life-line">
          That's <strong>${booksYear} extra books</strong>, <strong>${moviesYear} films</strong>,
          or <strong>${gymYear} gym sessions</strong> per year.
        </div>`;
    } else if (diffMin < 0) {
      // Target is slower — honest message
      const lossMin = Math.abs(diffMin);
      verdictEl.innerHTML = `
        <div class="cv-header">
          <span class="cv-badge" style="background:${fromMeta.color}22;color:${fromMeta.color}">${fromMeta.icon} ${fromMeta.label}</span>
          <span class="cv-arrow">→</span>
          <span class="cv-badge" style="background:${toMeta.color}22;color:${toMeta.color}">${toMeta.icon} ${toMeta.label}</span>
        </div>
        <div class="cv-win-line" style="color:rgba(255,255,255,0.7);">
          ${toMeta.label} takes <strong style="color:#F5A623">${Math.round(lossMin)} min more</strong> per trip on this road type.
          ${annualSaving > 0 ? `But you'd still save <strong style="color:#3EC278">€${Math.round(annualSaving)}/year</strong>.` : ''}
        </div>
        <div class="cv-life-line" style="color:rgba(255,255,255,0.5);">
          Consider the cost savings and environmental benefits even if time is similar.
        </div>`;
    } else {
      verdictEl.innerHTML = `<div class="cv-win-line">Same travel time — but ${toMeta.label} costs less and pollutes less. Worth it?</div>`;
    }
  }

  // ── Dramatic counter ──────────────────────────────────
  function updateDramaticCounter(r) {
    const from     = challenge.currentVehicle;
    const meta     = V_META[from];
    const labelEl  = document.getElementById('challenge-losing-label');
    const subEl    = document.getElementById('challenge-dramatic-sub');
    const numEl    = document.getElementById('hours-lost-year');
    if (!numEl) return;

    if (!r) {
      if (labelEl) labelEl.textContent = 'Right now, you lose';
      if (subEl)   subEl.textContent   = 'sitting in traffic, breathing exhaust, watching life pass by.';
      return;
    }

    const fromMin  = r[from].durationMin;
    const daysWeek = window._lastDaysPerWeek || 5;
    const hoursYear = Math.round(fromMin * daysWeek * 2 * 50 / 60);

    if (labelEl) labelEl.textContent = `As a ${meta.label} commuter, you spend`;
    if (subEl) {
      const toMeta = V_META[challenge.targetVehicle];
      const toMin  = r[challenge.targetVehicle]?.durationMin || fromMin;
      const saving = Math.max(0, Math.round((fromMin - toMin) * daysWeek * 2 * 50 / 60));
      subEl.textContent = saving > 0
        ? `${saving} of those hours could vanish if you switched to ${toMeta.label}.`
        : `commuting every year. Is there a smarter way?`;
    }

    window.lastCarTimeYear = hoursYear;

    if (window.gsap) {
      const obj = { val: parseInt(numEl.textContent.replace(/,/g,'')) || 0 };
      window.gsap.to(obj, {
        val: hoursYear, duration: 1.8, ease: 'power2.out',
        onUpdate() { numEl.textContent = Math.round(obj.val).toLocaleString('en'); },
      });
    } else {
      numEl.textContent = hoursYear.toLocaleString('en');
    }
  }

  // ── Populate share card ───────────────────────────────
  function populateShareCard() {
    const r    = window._lastTimeResult;
    const from = challenge.currentVehicle;
    const to   = challenge.targetVehicle;
    const fMeta = V_META[from];
    const tMeta = V_META[to];
    const fmt   = m => m < 60 ? `${Math.round(m)} min` : `${Math.floor(m/60)}h ${Math.round(m%60)}m`;
    const days  = window._lastDaysPerWeek || 5;

    // ── Name headline ──
    const name      = (document.getElementById('share-name')?.value || '').trim();
    const nameEl    = document.getElementById('sc-name-headline');
    const nameText  = document.getElementById('sc-name-text');
    if (nameEl && name) {
      if (nameText) nameText.textContent = name;
      const r2   = window._lastTimeResult;
      const days = window._lastDaysPerWeek || 5;
      let gains  = '';
      if (r2) {
        const diffMin  = r2[from].durationMin - r2[to].durationMin;
        const annualH  = Math.round(diffMin * days * 2 * 50 / 60);
        const saving   = window.CostModule ? Math.round(window.CostModule.getAnnualSaving()) : 0;
        const books    = Math.floor(Math.max(annualH, 0) / 5);
        const parts    = [];
        if (annualH > 0)  parts.push(`${annualH}h/year reclaimed`);
        if (saving > 0)   parts.push(`€${saving}/year saved`);
        if (books > 0)    parts.push(`${books} extra books`);
        if (parts.length) gains = ': ' + parts.join(', ') + '.';
      }
      nameEl.innerHTML = `<span>${name}</span> switched from ${fMeta.label.toLowerCase()} to ${tMeta.label.toLowerCase()}${gains}`;
      nameEl.style.display = 'block';
    } else if (nameEl) {
      nameEl.style.display = 'none';
    }

    // ── From / To blocks ──
    setEl('sc-from-badge',   fMeta.icon);
    setEl('sc-from-vehicle', fMeta.label);
    setEl('sc-from-time',    r ? fmt(r[from].durationMin) + ' per trip' : '— per trip');
    const fromBadge = document.getElementById('sc-from-badge');
    if (fromBadge) fromBadge.style.background = fMeta.color + '33';

    setEl('sc-to-badge',   tMeta.icon);
    setEl('sc-to-vehicle', tMeta.label);
    setEl('sc-to-time',    r ? fmt(r[to].durationMin) + ' per trip' : '— per trip');
    const toBadge = document.getElementById('sc-to-badge');
    if (toBadge) {
      toBadge.style.background = tMeta.color + '33';
      const toBlock = document.querySelector('.sc-to-block');
      if (toBlock) toBlock.style.borderColor = tMeta.color;
    }

    // ── Win bar ──
    if (r) {
      const diffMin  = r[from].durationMin - r[to].durationMin;
      const annualH  = Math.round(diffMin * days * 2 * 50 / 60);

      // Cost saving specific to the selected switch (from→to), not hardcoded car→scooter
      const costData = window._lastCostData || {};
      const saving   = (from === 'car' && to === 'scooter') ? (costData.annual || 0)
                     : 0; // other pairs: cost calc not yet extended; show — rather than wrong number

      setEl('sc-win-min',    Math.round(diffMin * 2) + ' min');
      setEl('sc-win-hours',  annualH > 0 ? annualH + 'h' : '—');
      setEl('sc-win-saving', saving > 0 ? '€' + Math.round(saving) : '—');

      // Life gains from actual activity calculation (if available) or computed inline
      const act    = window._lastActivityData;
      const hoursY = Math.max(annualH, 0);
      setEl('sc-lg-books',   act ? act.books   : Math.floor(hoursY / 5));
      setEl('sc-lg-movies',  act ? act.movies  : Math.floor(hoursY / 2));
      setEl('sc-lg-gym',     act ? act.gym     : Math.floor(hoursY / 0.75));
      setEl('sc-lg-dinners', act ? act.dinners : Math.floor(hoursY / 1.5));
    }
  }

  // ── Generate + download ───────────────────────────────
  async function generateShareCard() {
    const btn  = document.getElementById('generate-share-card');
    const card = document.getElementById('share-card');
    if (!card) return;

    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

    populateShareCard();

    if (!window.html2canvas) { showFallback(); restoreBtn(btn); return; }

    try {
      const canvas = await html2canvas(card, {
        width: 1080, height: 1080, scale: 1,
        useCORS: false, allowTaint: false,
        backgroundColor: '#1C2333', logging: false,
      });
      const link = document.createElement('a');
      link.download = 'smartcommute-share.png';
      link.href     = canvas.toDataURL('image/png', 0.95);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('[share.js] html2canvas failed:', err);
      showFallback();
    }

    restoreBtn(btn);
  }

  function bindGenerateBtn() {
    const btn = document.getElementById('generate-share-card');
    if (btn) btn.addEventListener('click', generateShareCard);
  }

  // ── Text fallback ─────────────────────────────────────
  function showFallback() {
    const r    = window._lastTimeResult;
    const from = challenge.currentVehicle;
    const to   = challenge.targetVehicle;
    const fmt  = m => m < 60 ? `${Math.round(m)}min` : `${Math.floor(m/60)}h${Math.round(m%60)}m`;
    const days = window._lastDaysPerWeek || 5;
    const name = (document.getElementById('share-name')?.value || '').trim();

    let text = name
      ? `🛵 ${name} switched from ${V_META[from].label} to ${V_META[to].label} — and won back life.\n\n`
      : `🛵 SmartCommute — My Switch\n\n`;

    if (r) {
      const diffMin  = r[from].durationMin - r[to].durationMin;
      const annualH  = Math.round(diffMin * days * 2 * 50 / 60);
      const saving   = window.CostModule ? Math.round(window.CostModule.getAnnualSaving()) : 0;
      text += `${V_META[from].icon} ${V_META[from].label}: ${fmt(r[from].durationMin)}/trip\n`;
      text += `${V_META[to].icon} ${V_META[to].label}: ${fmt(r[to].durationMin)}/trip\n\n`;
      text += `⏱ ${Math.round(diffMin * 2)} min saved/day · ${annualH}h/year reclaimed\n`;
      if (saving > 0) text += `💰 €${saving}/year saved\n`;
      text += `📚 ${Math.floor(Math.max(annualH,0)/5)} extra books · 🎬 ${Math.floor(Math.max(annualH,0)/2)} films/year\n`;
    }
    text += `\nCalculate yours → smartcommute.app`;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `<div style="background:#1C2333;border-radius:16px;padding:32px;max-width:500px;width:100%;border:1px solid rgba(255,255,255,0.1);">
      <h3 style="margin-bottom:12px;font-family:system-ui;font-size:18px;color:#fff;">Share your results</h3>
      <textarea id="share-fallback-text" style="width:100%;height:180px;font-size:13px;padding:12px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;resize:none;font-family:system-ui;background:#0F1220;color:#fff;">${text}</textarea>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button onclick="document.getElementById('share-fallback-text').select();document.execCommand('copy');this.textContent='Copied! ✓';" style="flex:1;padding:12px;background:#4F8EF7;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600;">Copy text</button>
        <button onclick="this.closest('[style*=fixed]').remove();" style="padding:12px 16px;background:rgba(255,255,255,0.1);border:none;border-radius:8px;font-size:14px;cursor:pointer;color:#fff;">Close</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  function setEl(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }

  function restoreBtn(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> Generate my share card`;
  }

  // expose for re-use
  window.renderChallengeVerdict = renderChallengeVerdict;
  window.getChallengeVehicles   = () => ({ from: challenge.currentVehicle, to: challenge.targetVehicle });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
