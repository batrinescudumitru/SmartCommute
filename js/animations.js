/* global gsap, ScrollTrigger */

(function () {
  'use strict';

  function init() {
    if (!window.gsap) { console.warn('[animations.js] GSAP not loaded'); return; }
    if (window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

    setupScrollFades();
    setupChallengeCounter();
    setupNavHighlight();
    setupNavHamburger();
    setupProgressDots();
    setupRepeatBtn();
  }

  // ── Scroll fade-ins for section headings ─────────────
  function setupScrollFades() {
    if (!ScrollTrigger) return;

    const targets = document.querySelectorAll('.module-section h2, .module-section h3, .module-section .section-sub, .module-section .section-eyebrow');
    targets.forEach(el => {
      gsap.fromTo(el,
        { opacity: 0, y: 22 },
        {
          opacity: 1, y: 0,
          duration: 0.85,
          ease: 'power2.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        }
      );
    });
  }

  // ── GSAP count-up utility (exposed globally) ─────────
  window.animateNumber = function (elementId, targetValue, opts = {}) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const { prefix = '', suffix = '', decimals = 0, duration = 1.4 } = opts;
    const obj = { val: 0 };
    gsap.to(obj, {
      val: targetValue,
      duration,
      ease: 'power2.out',
      onUpdate() {
        const v = decimals ? obj.val.toFixed(decimals) : Math.round(obj.val);
        el.textContent = prefix + Number(v).toLocaleString('en') + suffix;
        el.classList.add('count-updated');
        setTimeout(() => el.classList.remove('count-updated'), 350);
      },
    });
  };

  // ── Animate progress bar (exposed globally) ──────────
  window.animateBar = function (elementId, targetPct) {
    const el = document.getElementById(elementId);
    if (!el) return;
    gsap.to(el, { width: targetPct + '%', duration: 1.1, ease: 'power2.out' });
  };

  // ── Result cards stagger (called by map.js after render)
  window.triggerResultAnimations = function () {
    if (!gsap) return;
    // Short delay so DOM is painted
    setTimeout(() => {
      const cards = document.querySelectorAll('.results-grid .result-card');
      gsap.fromTo(cards,
        { opacity: 0, y: 28, scale: 0.97 },
        {
          opacity: 1, y: 0, scale: 1,
          duration: 0.65,
          ease: 'back.out(1.4)',
          stagger: 0.12,
        }
      );
    }, 30);
  };

  // ── Vehicle race ──────────────────────────────────────
  // Stored so Repeat button can replay with same times
  let _lastRaceTimes = null;

  window.runVehicleRace = function (carMin, scooterMin, bikeMin, transitMin, walkMin) {
    _lastRaceTimes = { carMin, scooterMin, bikeMin, transitMin, walkMin };
    _startRace(carMin, scooterMin, bikeMin, transitMin, walkMin);
  };

  function _startRace(carMin, scooterMin, bikeMin, transitMin, walkMin) {
    const raceSection = document.getElementById('race-section');
    if (!raceSection || !gsap) return;

    const MEDALS = ['🥇', '🥈', '🥉', '🏅', '🏅'];

    const vehicles = [
      { key: 'car',     el: document.querySelector('.race-car'),     min: carMin,     timeId: 'race-time-car'     },
      { key: 'scooter', el: document.querySelector('.race-scooter'), min: scooterMin, timeId: 'race-time-scooter' },
      { key: 'bike',    el: document.querySelector('.race-bike'),     min: bikeMin,    timeId: 'race-time-bike'    },
      { key: 'transit', el: document.querySelector('.race-transit'), min: transitMin || (carMin * 0.75), timeId: 'race-time-transit' },
      { key: 'walk',    el: document.querySelector('.race-walk'),    min: walkMin    || (carMin * 4),    timeId: 'race-time-walk'    },
    ].filter(v => v.el); // only include vehicles present in DOM

    // Clear previous state
    vehicles.forEach(v => {
      gsap.killTweensOf(v.el);
      gsap.set(v.el, { x: 0, opacity: 1, filter: 'none' });
      v.el.classList.remove('finished', 'frozen');
      const m = document.getElementById(`race-medal-${v.key}`);
      if (m) { m.textContent = ''; gsap.set(m, { scale: 1, opacity: 1 }); }
    });

    const repeatBtn = document.getElementById('race-repeat-btn');
    if (repeatBtn) repeatBtn.style.display = 'none';

    const minTime    = Math.min(...vehicles.map(v => v.min));
    const RACE_DUR   = 3.5;
    const scale      = RACE_DUR / minTime;
    const trackEl    = document.querySelector('.race-lane-track');
    const trackW     = trackEl ? trackEl.clientWidth - 56 : 300;

    // Sorted by speed (fastest first) → assign podium positions
    const sorted     = [...vehicles].sort((a, b) => a.min - b.min);
    let finishCount  = 0;
    let winnerDone   = false;

    vehicles.forEach(v => {
      const dur = v.min * scale;

      gsap.fromTo(v.el,
        { x: 0 },
        {
          x: trackW,
          duration: dur,
          ease: 'power1.inOut',
          delay: 0.4,
          onComplete() {
            finishCount++;
            const place   = sorted.findIndex(s => s.key === v.key);
            const medalEl = document.getElementById(`race-medal-${v.key}`);

            if (!winnerDone) {
              // First to finish: bounce + freeze everyone else
              winnerDone = true;
              v.el.classList.add('finished');
              if (medalEl) {
                medalEl.textContent = MEDALS[0];
                gsap.fromTo(medalEl, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2.5)' });
              }
              // Freeze all still-moving vehicles
              vehicles.forEach(other => {
                if (other.key === v.key) return;
                gsap.killTweensOf(other.el);
                gsap.to(other.el, { opacity: 0.4, filter: 'grayscale(80%)', duration: 0.35, ease: 'power2.out' });
                other.el.classList.add('frozen');
                // Give them their place medal based on how far they got (proportional to time)
                const otherPlace = sorted.findIndex(s => s.key === other.key);
                const otherMedal = document.getElementById(`race-medal-${other.key}`);
                if (otherMedal && MEDALS[otherPlace]) {
                  setTimeout(() => {
                    otherMedal.textContent = MEDALS[otherPlace];
                    gsap.fromTo(otherMedal, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2)' });
                  }, (otherPlace) * 180);
                }
              });
            }

            // Show Repeat button after winner finishes (don't wait for frozen ones)
            if (!repeatBtn || repeatBtn.style.display !== 'none') return;
            if (finishCount >= 1) {
              setTimeout(() => {
                repeatBtn.style.display = 'inline-flex';
                gsap.fromTo(repeatBtn, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
              }, 600);
            }
          },
        }
      );
    });

    raceSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Repeat button
  function setupRepeatBtn() {
    const btn = document.getElementById('race-repeat-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (_lastRaceTimes) {
        const { carMin, scooterMin, bikeMin, transitMin, walkMin } = _lastRaceTimes;
        _startRace(carMin, scooterMin, bikeMin, transitMin, walkMin);
      }
    });
  }

  // ── Challenge counter (dramatic scroll trigger) ───────
  function setupChallengeCounter() {
    if (!ScrollTrigger) return;

    ScrollTrigger.create({
      trigger: '#challenge',
      start: 'top 75%',
      once: true,
      onEnter() {
        const hoursLost = window.lastCarTimeYear || 107; // INRIX default
        const el = document.getElementById('hours-lost-year');
        if (!el) return;
        const obj = { val: 0 };
        gsap.to(obj, {
          val: hoursLost,
          duration: 2.8,
          ease: 'power2.out',
          onUpdate() { el.textContent = Math.round(obj.val).toLocaleString('en'); },
        });
      },
    });

    // Also update if route result changes after counter fired
    window.updateChallengeCounter = function (carMinPerTrip) {
      const hoursLost = Math.round(carMinPerTrip * 500 / 60);
      window.lastCarTimeYear = hoursLost;
      const el = document.getElementById('hours-lost-year');
      if (!el) return;
      const obj = { val: parseInt(el.textContent.replace(/,/g, '') || 0, 10) };
      gsap.to(obj, {
        val: hoursLost,
        duration: 1.4,
        ease: 'power2.out',
        onUpdate() { el.textContent = Math.round(obj.val).toLocaleString('en'); },
      });
    };
  }

  // ── Challenge hours slider ────────────────────────────
  function setupChallengeSlider() {
    const range   = document.getElementById('challenge-hours-range');
    const display = document.getElementById('challenge-hours-display');
    const verdict = document.getElementById('challenge-verdict');
    if (!range) return;

    function update() {
      const h = parseFloat(range.value);
      if (display) display.textContent = h.toFixed(1).replace('.0', '') + ' h/week';
      if (verdict) updateChallengeVerdict(h, verdict);
    }

    range.addEventListener('input', update);
    update();
  }

  function updateChallengeVerdict(targetHours, verdictEl) {
    const result = window.getLastRouteResult ? window.getLastRouteResult() : null;

    if (!result) {
      verdictEl.textContent = `To gain ${targetHours.toFixed(1).replace('.0', '')} hours per week, calculate your route above and see exactly which vehicle gets you there.`;
      verdictEl.classList.remove('empty');
      return;
    }

    const carMin     = result.car.durationMin;
    const scooterMin = result.scooter.durationMin;
    const bikeMin    = result.bike.durationMin;

    const scSaving   = ((carMin - scooterMin) * 10) / 60; // h/week (10 trips)
    const bikeSaving = ((carMin - bikeMin)    * 10) / 60;
    const targetMin  = targetHours * 60;
    const tripsNeeded = Math.ceil(targetMin / Math.max(carMin - scooterMin, 0.1));

    let html = '';

    if (scSaving >= targetHours) {
      const savingPerYear = Math.round(scSaving * 50);
      html = `🛵 <strong>Switch to scooter</strong> for all commutes and you'll gain <strong>${scSaving.toFixed(1).replace('.0', '')} hours/week</strong> — that's <strong>${savingPerYear} hours per year</strong>. `;
      if (window.CostModule) {
        const annual = window.CostModule.getAnnualSaving ? window.CostModule.getAnnualSaving() : null;
        if (annual) html += `You'll also save roughly <strong>€${Math.round(annual)}/year</strong> in fuel and parking.`;
      }
    } else if (tripsNeeded <= 5) {
      html = `🛵 Use the <strong>scooter ${tripsNeeded} days/week</strong> instead of driving to gain <strong>${targetHours.toFixed(1).replace('.0', '')} hours/week</strong>.`;
    } else {
      html = `⚡ With this route, even switching to scooter full-time gives ${scSaving.toFixed(1).replace('.0', '')} h/week. Consider combining with remote work days to hit your ${targetHours.toFixed(1).replace('.0', '')} h goal.`;
    }

    if (bikeSaving >= targetHours) {
      html += `<br>🚲 A <strong>bicycle</strong> also achieves your goal: <strong>${bikeSaving.toFixed(1).replace('.0', '')} h/week</strong> saved, plus calories burned.`;
    }

    verdictEl.innerHTML = html;
    verdictEl.classList.remove('empty');
  }

  // ── Active nav link on scroll ─────────────────────────
  function setupNavHighlight() {
    const sections = ['hero', 'time', 'cost', 'value', 'challenge'];
    const links    = document.querySelectorAll('.nav-links a[href^="#"]');

    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          links.forEach(a => {
            a.classList.toggle('active', a.getAttribute('href') === `#${id}`);
          });
          updateProgressDots(id);
        }
      });
    }, { threshold: 0.4 });

    sections.forEach(id => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
  }

  // ── Progress dots ─────────────────────────────────────
  function setupProgressDots() {
    const dots = document.querySelectorAll('.progress-dot');
    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const target = document.getElementById(dot.dataset.target);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  function updateProgressDots(activeId) {
    const sections = ['hero', 'time', 'cost', 'value', 'challenge'];
    const dots     = document.querySelectorAll('.progress-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', sections[i] === activeId);
    });
  }

  // ── Nav hamburger ─────────────────────────────────────
  function setupNavHamburger() {
    const btn = document.getElementById('nav-hamburger');
    const nav = document.getElementById('site-nav');
    if (!btn || !nav) return;

    btn.addEventListener('click', () => nav.classList.toggle('open'));

    document.querySelectorAll('.nav-links a').forEach(a => {
      a.addEventListener('click', () => nav.classList.remove('open'));
    });
  }

  // ── Boot ──────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      // Challenge slider needs DOM ready
      setTimeout(setupChallengeSlider, 0);
    });
  } else {
    init();
    setTimeout(setupChallengeSlider, 0);
  }

}());
