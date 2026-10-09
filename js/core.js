/* Prayer-time maths for travellers in flight.
 *
 * The aircraft is modelled as a position (lat, lon, altitude) that changes with time. Every prayer
 * boundary is the moment a function of the sun's altitude / hour angle crosses a threshold, so we
 * sample the whole trip (plus a day either side, on the ground) and detect the crossings.
 * Works in the browser (window.PrayerCore) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const RAD = Math.PI / 180, DEG = 180 / Math.PI;
  const KAABA = { lat: 21.4225, lon: 39.8262 };
  const MIN = 60000, HOUR = 3600000;
  const STEP = MIN;
  const PAD = 30 * HOUR; // simulated ground time before departure / after arrival

  // fajr / isha are twilight angles in degrees; ishaMin means "N minutes after maghrib" instead.
  const METHODS = {
    MWL: { name: 'Muslim World League', fajr: 18, isha: 17 },
    ISNA: { name: 'ISNA (North America)', fajr: 15, isha: 15 },
    EGYPT: { name: 'Egyptian General Authority', fajr: 19.5, isha: 17.5 },
    KARACHI: { name: 'Univ. of Islamic Sciences, Karachi', fajr: 18, isha: 18 },
    UMM_AL_QURA: { name: 'Umm al-Qura (Makkah)', fajr: 18.5, ishaMin: 90 },
    GULF: { name: 'Gulf Region', fajr: 19.5, ishaMin: 90 },
    KUWAIT: { name: 'Kuwait', fajr: 18, isha: 17.5 },
    QATAR: { name: 'Qatar', fajr: 18, ishaMin: 90 },
    SINGAPORE: { name: 'Singapore (MUIS)', fajr: 20, isha: 18 },
    FRANCE: { name: 'France (UOIF)', fajr: 12, isha: 12 },
    TURKEY: { name: 'Turkey (Diyanet)', fajr: 18, isha: 17 },
    RUSSIA: { name: 'Russia (Spiritual Admin.)', fajr: 16, isha: 15 },
    TEHRAN: { name: 'Tehran (Univ. of Geophysics)', fajr: 17.7, isha: 14, maghribAngle: 4.5 },
    JAFARI: { name: "Shia Ithna-Ashari (Ja'fari)", fajr: 16, isha: 14, maghribAngle: 4 },
  };

  const MADHHABS = {
    hanafi: { name: 'Hanafi', asrFactor: 2, qasrKm: 77, qasrObligatory: true },
    maliki: { name: 'Maliki', asrFactor: 1, qasrKm: 81, qasrObligatory: false },
    shafii: { name: "Shafi'i", asrFactor: 1, qasrKm: 81, qasrObligatory: false },
    hanbali: { name: 'Hanbali', asrFactor: 1, qasrKm: 80, qasrObligatory: false },
    jafari: { name: "Ja'fari (Shia Ithna-Ashari)", asrFactor: 1, qasrKm: 44, qasrObligatory: true },
  };

  const HIGH_LAT = {
    none: 'None (show when a prayer does not occur)',
    middle: 'Middle of the night (if twilight is missing)',
    seventh: 'One-seventh of the night (if twilight is missing)',
    angle: 'Angle-based (if twilight is missing)',
  };

  const norm180 = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
  const norm360 = (x) => ((x % 360) + 360) % 360;

  /* ---------- astronomy ---------- */

  // Solar declination (deg) and equation of time (minutes) at a UTC instant (low-precision, ~1 min).
  function solar(tMs) {
    const n = tMs / 86400000 + 2440587.5 - 2451545.0;
    const L = norm360(280.46 + 0.9856474 * n);
    const g = norm360(357.528 + 0.9856003 * n) * RAD;
    const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
    const eps = (23.439 - 0.0000004 * n) * RAD;
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam)) * DEG;
    const ra = norm360(Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * DEG);
    const eot = norm180(L - ra) * 4;
    return { dec, eot };
  }

  // Sun altitude (deg) and local hour angle (deg, 0 = solar noon, negative = morning).
  function sunAt(tMs, lat, lon) {
    const s = solar(tMs);
    const utcMin = (((tMs % 86400000) + 86400000) % 86400000) / MIN;
    const H = norm180((utcMin + s.eot + 4 * lon) / 4 - 180);
    const sinA = Math.sin(lat * RAD) * Math.sin(s.dec * RAD) +
      Math.cos(lat * RAD) * Math.cos(s.dec * RAD) * Math.cos(H * RAD);
    return { alt: Math.asin(Math.max(-1, Math.min(1, sinA))) * DEG, H, dec: s.dec };
  }

  // Apparent horizon dip (deg) for an observer at height h metres.
  const horizonDip = (h) => (h > 0 ? 0.0293 * Math.sqrt(h) : 0);

  function asrAltitude(lat, dec, factor) {
    return Math.atan(1 / (factor + Math.tan(Math.abs(lat - dec) * RAD))) * DEG;
  }

  /* ---------- geography ---------- */

  function toVec(lat, lon) {
    return [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
  }

  function distanceKm(a, b) {
    const v = toVec(a.lat, a.lon), w = toVec(b.lat, b.lon);
    const d = v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
    return 6371.0088 * Math.acos(Math.max(-1, Math.min(1, d)));
  }

  // Point a fraction f (0..1) along the great circle from a to b.
  function gcPoint(a, b, f) {
    const v = toVec(a.lat, a.lon), w = toVec(b.lat, b.lon);
    const d = Math.acos(Math.max(-1, Math.min(1, v[0] * w[0] + v[1] * w[1] + v[2] * w[2])));
    if (d < 1e-9) return { lat: a.lat, lon: a.lon };
    const k1 = Math.sin((1 - f) * d) / Math.sin(d), k2 = Math.sin(f * d) / Math.sin(d);
    const x = k1 * v[0] + k2 * w[0], y = k1 * v[1] + k2 * w[1], z = k1 * v[2] + k2 * w[2];
    return { lat: Math.atan2(z, Math.hypot(x, y)) * DEG, lon: Math.atan2(y, x) * DEG };
  }

  // Initial bearing (deg from true north) from a to b.
  function bearing(a, b) {
    const p1 = a.lat * RAD, p2 = b.lat * RAD, dl = (b.lon - a.lon) * RAD;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return norm360(Math.atan2(y, x) * DEG);
  }

  const qiblaFrom = (p) => bearing(p, KAABA);

  /* ---------- time zones ---------- */

  function tzOffsetMs(tMs, tz) {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    const p = {};
    f.formatToParts(new Date(tMs)).forEach((x) => { p[x.type] = +x.value; });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(tMs / 1000) * 1000;
  }

  // Wall-clock time in an IANA zone -> UTC ms.
  function zonedToUtc(y, mo, d, h, mi, tz) {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    let t = guess - tzOffsetMs(guess, tz);
    const off2 = tzOffsetMs(t, tz);
    if (guess - off2 !== t) t = guess - off2;
    return t;
  }

  /* ---------- flight model ---------- */

  // flight: { dep:{lat,lon,...}, arr:{...}, depUtc, arrUtc (gate times, ms), taxiOutMin, taxiInMin, cruiseFt }
  function flightTimes(f) {
    const takeoff = f.depUtc + (f.taxiOutMin || 0) * MIN;
    const landing = f.arrUtc - (f.taxiInMin || 0) * MIN;
    return { takeoff, landing };
  }

  function flightState(f) {
    const { takeoff, landing } = flightTimes(f);
    const cruiseM = (f.cruiseFt || 35000) * 0.3048;
    const durMin = (landing - takeoff) / MIN;
    const climb = Math.max(1, Math.min(22, durMin * 0.35));
    const descent = Math.max(1, Math.min(28, durMin * 0.35));
    return function (t) {
      if (t <= takeoff) return { lat: f.dep.lat, lon: f.dep.lon, alt: 0, airborne: false, frac: 0 };
      if (t >= landing) return { lat: f.arr.lat, lon: f.arr.lon, alt: 0, airborne: false, frac: 1 };
      const frac = (t - takeoff) / (landing - takeoff);
      const p = gcPoint(f.dep, f.arr, frac);
      const k = Math.min(1, (t - takeoff) / MIN / climb, (landing - t) / MIN / descent);
      return { lat: p.lat, lon: p.lon, alt: cruiseM * k, airborne: true, frac };
    };
  }

  /* ---------- prayer events ---------- */

  const PRAYER_ORDER = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const WINDOW_END = { fajr: 'sunrise', dhuhr: 'asr', asr: 'maghrib', maghrib: 'isha', isha: 'fajr' };

  /*
   * stateFn(t) -> {lat, lon, alt (m), airborne}
   * opts: { madhhab, method, highLat, altitude }
   * Returns events sorted by time: { type, t, lat, lon, alt, airborne, qibla, adjusted? }
   */
  function computeEvents(stateFn, startMs, endMs, opts) {
    const m = METHODS[opts.method] || METHODS.MWL;
    const asrFactor = (MADHHABS[opts.madhhab] || MADHHABS.shafii).asrFactor;
    const useAlt = opts.altitude !== false;
    const events = [];

    const mk = (type, t, extra) => {
      const s = stateFn(t);
      return Object.assign({
        type, t, lat: s.lat, lon: s.lon, alt: s.alt, airborne: s.airborne,
        qibla: qiblaFrom(s), frac: s.frac,
      }, extra);
    };

    const sample = (t) => {
      const s = stateFn(t);
      const sun = sunAt(t, s.lat, s.lon);
      const horizon = -0.833 - (useAlt ? horizonDip(s.alt) : 0);
      return {
        H: sun.H,
        horizon: sun.alt - horizon,
        fajr: sun.alt + m.fajr,
        isha: m.isha ? sun.alt + m.isha : 0,
        maghribA: m.maghribAngle ? sun.alt + m.maghribAngle : 0,
        asr: sun.alt - asrAltitude(s.lat, sun.dec, asrFactor),
      };
    };

    let prev = sample(startMs);
    for (let t = startMs + STEP; t <= endMs; t += STEP) {
      const cur = sample(t);
      const tAt = (a, b) => t - STEP + (-a / (b - a)) * STEP; // linear zero crossing
      const rising = (k) => prev[k] < 0 && cur[k] >= 0;
      const setting = (k) => prev[k] >= 0 && cur[k] < 0;
      const mid = (prev.H + cur.H) / 2;

      if (rising('fajr') && mid < 0) events.push(mk('fajr', tAt(prev.fajr, cur.fajr)));
      if (rising('horizon') && mid < 0) events.push(mk('sunrise', tAt(prev.horizon, cur.horizon)));
      if (prev.H < 0 && cur.H >= 0 && cur.H - prev.H < 90) events.push(mk('dhuhr', tAt(prev.H, cur.H)));
      if (setting('asr') && mid > 0) events.push(mk('asr', tAt(prev.asr, cur.asr)));
      if (m.maghribAngle) {
        if (setting('maghribA') && mid > 0) events.push(mk('maghrib', tAt(prev.maghribA, cur.maghribA)));
      } else if (setting('horizon') && mid > 0) {
        events.push(mk('maghrib', tAt(prev.horizon, cur.horizon)));
      }
      if (m.isha && setting('isha') && mid > 0) events.push(mk('isha', tAt(prev.isha, cur.isha)));
      prev = cur;
    }

    if (m.ishaMin) {
      events.filter((e) => e.type === 'maghrib').forEach((e) => events.push(mk('isha', e.t + m.ishaMin * MIN)));
    }

    applyHighLatitude(events, m, opts.highLat || 'none', mk);

    events.sort((a, b) => a.t - b.t);
    return events;
  }

  // Fill in a missing Fajr/Isha (sun never reaches the twilight angle) using a fraction of the night.
  // Deliberately not applied as a cap: the night-fraction rules assume a fixed observer.
  function applyHighLatitude(events, m, rule, mk) {
    if (rule === 'none') return;
    const portion = (angle) => (rule === 'middle' ? 0.5 : rule === 'seventh' ? 1 / 7 : (angle || 18) / 60);
    const sorted = events.slice().sort((a, b) => a.t - b.t);
    const maghribs = sorted.filter((e) => e.type === 'maghrib');
    maghribs.forEach((mag) => {
      const sr = sorted.find((e) => e.type === 'sunrise' && e.t > mag.t);
      if (!sr) return;
      const night = sr.t - mag.t;
      const fajrLimit = sr.t - portion(m.fajr) * night;
      const ishaLimit = mag.t + portion(m.isha || m.fajr) * night;

      const fajr = events.find((e) => e.type === 'fajr' && e.t > mag.t && e.t < sr.t);
      if (!fajr) events.push(mk('fajr', fajrLimit, { adjusted: true }));

      const isha = events.find((e) => e.type === 'isha' && e.t >= mag.t && e.t < sr.t);
      if (!isha) events.push(mk('isha', ishaLimit, { adjusted: true }));
    });
  }

  // Prayer windows [start, end) built from the event list.
  function buildWindows(events) {
    const out = [];
    events.forEach((e) => {
      const endType = WINDOW_END[e.type];
      if (!endType) return;
      const end = events.find((x) => x.type === endType && x.t > e.t);
      if (!end) return;
      // skip implausibly long windows (e.g. a missing Isha causing Maghrib to run to the next day)
      if (end.t - e.t > 20 * HOUR) return;
      out.push({ prayer: e.type, start: e.t, end: end.t, startEvent: e, endEvent: end });
    });
    return out;
  }

  /* ---------- flight analysis ---------- */

  // Ja'fari: Isha's time ends at (Islamic) midnight, the midpoint between Maghrib and Fajr.
  function applyJafariMidnight(windows) {
    windows.forEach((w) => {
      if (w.prayer !== 'isha') return;
      const m = windows.find((x) => x.prayer === 'maghrib' && Math.abs(x.end - w.start) < 2 * MIN);
      if (!m) return;
      const mid = (m.start + w.end) / 2;
      w.end = mid; w.endEvent = { type: 'midnight', t: mid };
    });
    return windows;
  }

  // Describe how each prayer window relates to the flight.
  function analyseWindows(windows, flight) {
    const { takeoff, landing } = flightTimes(flight);
    return windows
      .filter((w) => w.end > flight.depUtc && w.start < flight.arrUtc)
      .map((w) => {
        const a = Math.max(w.start, takeoff), b = Math.min(w.end, landing);
        const inFlight = b > a ? { from: a, to: b } : null;
        return Object.assign({}, w, {
          inFlight,
          opensBeforeTakeoff: w.start < takeoff,
          closesAfterLanding: w.end > landing,
          groundBeforeMs: w.start < takeoff ? Math.min(takeoff, w.end) - w.start : 0,
          groundAfterMs: w.end > landing ? w.end - Math.max(landing, w.start) : 0,
          sinceTakeoffMs: w.start - takeoff,
          beforeLandingMs: landing - w.start,
          endSinceTakeoffMs: w.end - takeoff,
          endBeforeLandingMs: landing - w.end,
        });
      });
  }

  const RULINGS = {
    jafari: {
      combine: 'shared',
      summary: "Ja'fari: Dhuhr and Asr share one time from zawal (solar noon) until sunset, with Dhuhr prayed first; Maghrib and Isha share one time from Maghrib (disappearance of the eastern redness) until midnight, with Maghrib first. You may pray them back to back anywhere in these shared times — no special travel condition is needed.",
      qasr: 'Shortening (qasr) is obligatory for a journey of about 44 km (8 farsakhs) or more, provided the other conditions are met.',
    },
    hanafi: {
      combine: 'none',
      summary: "Hanafi: combining two prayers in one time (jam' haqiqi) is not permitted while travelling (the exceptions are Arafah and Muzdalifah during Hajj). You may, however, pray 'apparent combining' (jam' suri): the first prayer at the very end of its time and the second at the very start of its own.",
      qasr: 'Shortening (qasr) is obligatory for a traveller covering about 77 km (48 miles) or more.',
    },
    maliki: {
      combine: 'travel',
      summary: "Maliki: a traveller may combine Dhuhr/Asr and Maghrib/Isha. Delaying (ta'khir) is generally preferred; combining early (taqdim) is allowed under conditions that scholars describe in more detail (e.g. being on the move when the second prayer's time enters).",
      qasr: 'Shortening (qasr) is a confirmed sunnah for a traveller covering about 81 km (≈ 48 miles) or more.',
    },
    shafii: {
      combine: 'travel',
      summary: "Shafi'i: a traveller on a permissible journey of qasr distance may combine Dhuhr/Asr and Maghrib/Isha, either early (taqdim) or late (ta'khir). For taqdim, pray the first prayer first, intend to combine, and be still travelling when you start the second prayer.",
      qasr: 'Shortening (qasr) is permitted for a journey of about 81 km (two marhalas) or more.',
    },
    hanbali: {
      combine: 'travel',
      summary: "Hanbali: a traveller of qasr distance may combine Dhuhr/Asr and Maghrib/Isha, either early (taqdim) or late (ta'khir), and it is better to follow whichever is easier or more suitable for the journey.",
      qasr: 'Shortening (qasr) is permitted (and preferred) for a journey of about 80 km or more.',
    },
  };

  /*
   * Combining check. For each pair returns the span in which both prayers can be prayed under
   * taqdim (first prayer's time) or ta'khir (second prayer's time), clipped to the flight, plus the
   * Hanafi 'apparent combining' boundary.
   */
  function combiningAnalysis(windows, flight, madhhab) {
    const { takeoff, landing } = flightTimes(flight);
    const md = MADHHABS[madhhab] || MADHHABS.shafii;
    const ruling = RULINGS[madhhab] || RULINGS.shafii;
    const km = distanceKm(flight.dep, flight.arr);
    const travelOk = km >= md.qasrKm;
    const clip = (w) => {
      if (!w) return null;
      const a = Math.max(w.start, takeoff), b = Math.min(w.end, landing);
      return {
        start: w.start, end: w.end,
        inFlight: b > a ? { from: a, to: b } : null,
        onGroundBefore: w.start < takeoff && w.end > flight.depUtc,
        onGroundAfter: w.end > landing && w.start < flight.arrUtc,
      };
    };
    const pairs = [['dhuhr', 'asr', 'Dhuhr + Asr'], ['maghrib', 'isha', 'Maghrib + Isha']];
    const result = [];
    pairs.forEach(([p1, p2, label]) => {
      windows.filter((w) => w.prayer === p1).forEach((w1) => {
        const w2 = windows.find((w) => w.prayer === p2 && Math.abs(w.start - w1.end) < 2 * MIN);
        if (!w2) return;
        if (!(w2.end > flight.depUtc && w1.start < flight.arrUtc)) return;
        result.push({
          label, first: p1, second: p2, w1, w2,
          taqdim: clip(w1), takhir: clip(w2),
          shared: clip({ start: w1.start, end: w2.end }), // Ja'fari: one shared time for both prayers
          boundary: w1.end, // jam' suri pivot: first prayer just before, second just after
          boundaryInFlight: w1.end > takeoff && w1.end < landing,
        });
      });
    });
    return { km, travelOk, md, ruling, pairs: result };
  }

  const api = {
    METHODS, MADHHABS, HIGH_LAT, KAABA, PRAYER_ORDER, RULINGS,
    solar, sunAt, horizonDip, asrAltitude, distanceKm, gcPoint, bearing, qiblaFrom,
    tzOffsetMs, zonedToUtc, flightTimes, flightState, computeEvents, buildWindows,
    analyseWindows, combiningAnalysis, applyJafariMidnight, PAD, MIN, HOUR,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PrayerCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
