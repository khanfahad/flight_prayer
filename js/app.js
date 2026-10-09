/* UI for Flight Prayer Times. Depends on window.PrayerCore, AIRPORTS, AIRLINES and Leaflet (L). */
(function () {
  'use strict';
  const C = window.PrayerCore;
  const $ = (id) => document.getElementById(id);
  const MIN = C.MIN, HOUR = C.HOUR;

  const AP = {};
  window.AIRPORTS.forEach((a) => {
    AP[a[0]] = { iata: a[0], name: a[1], city: a[2], country: a[3], lat: a[4], lon: a[5], elev: a[6], tz: a[7] };
  });

  const COLORS = { fajr: '#5b6ee1', sunrise: '#f0a30a', dhuhr: '#e8c11a', asr: '#e07b24', maghrib: '#d6455d', isha: '#6b3fa0' };
  const LABEL = { fajr: 'Fajr', sunrise: 'Sunrise', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };

  /* ---------- storage ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('fp_' + k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('fp_' + k, v); } catch (e) { /* ignore */ } },
  };

  /* ---------- formatting ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  function fmtTime(ms, tz) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  }
  function fmtDur(ms) {
    const neg = ms < 0; let m = Math.round(Math.abs(ms) / MIN);
    const h = Math.floor(m / 60); m %= 60;
    return (neg ? '−' : '') + (h ? h + 'h ' : '') + pad(m).replace(/^0(\d)$/, '$1') + 'm';
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const compass = (deg) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16];
  const airportLabel = (a) => `${a.iata} — ${a.name}${a.city ? ' (' + a.city + ')' : ''}`;

  /* ---------- settings ---------- */
  function fillSelect(el, obj, key, fallback) {
    el.innerHTML = Object.keys(obj).map((k) => `<option value="${k}">${esc(typeof obj[k] === 'string' ? obj[k] : obj[k].name)}</option>`).join('');
    el.value = store.get(key, fallback);
    if (!el.value) el.value = fallback;
    el.addEventListener('change', () => store.set(key, el.value));
  }
  fillSelect($('madhhab'), C.MADHHABS, 'madhhab', 'shafii');
  fillSelect($('method'), C.METHODS, 'method', 'MWL');
  fillSelect($('highLat'), C.HIGH_LAT, 'highLat', 'angle');
  $('altitude').checked = store.get('altitude', '1') === '1';
  $('altitude').addEventListener('change', () => store.set('altitude', $('altitude').checked ? '1' : '0'));
  $('apiKey').value = store.get('apiKey', '');
  $('apiKey').addEventListener('change', () => store.set('apiKey', $('apiKey').value.trim()));
  $('flightDate').value = new Date().toISOString().slice(0, 10);

  /* ---------- airport autocomplete ---------- */
  function searchAirports(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [], seen = {};
    const push = (a) => { if (!seen[a.iata] && out.length < 8) { seen[a.iata] = 1; out.push(a); } };
    if (AP[q.toUpperCase()]) push(AP[q.toUpperCase()]);
    const all = Object.values(AP);
    all.filter((a) => a.city.toLowerCase().startsWith(q) || a.name.toLowerCase().startsWith(q)).forEach(push);
    all.filter((a) => a.city.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)).forEach(push);
    return out;
  }
  function setupAirport(inputId, listId) {
    const input = $(inputId), list = $(listId);
    input.addEventListener('input', () => {
      input.dataset.iata = '';
      const exact = AP[input.value.trim().toUpperCase()];
      if (exact && input.value.trim().length === 3) input.dataset.iata = exact.iata;
      const res = searchAirports(input.value);
      list.innerHTML = res.map((a) => `<li data-i="${a.iata}"><b>${a.iata}</b> ${esc(a.name)} <small>${esc(a.city)}, ${esc(a.country)}</small></li>`).join('');
    });
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li'); if (!li) return;
      e.preventDefault(); choose(li.dataset.i);
    });
    list.addEventListener('touchstart', (e) => {
      const li = e.target.closest('li'); if (!li) return;
      e.preventDefault(); choose(li.dataset.i);
    }, { passive: false });
    input.addEventListener('blur', () => setTimeout(() => { list.innerHTML = ''; }, 150));
    function choose(iata) { setAirport(input, iata); list.innerHTML = ''; }
  }
  function setAirport(input, iata) {
    const a = AP[iata]; if (!a) return false;
    input.value = airportLabel(a); input.dataset.iata = iata; return true;
  }
  setupAirport('from', 'fromList');
  setupAirport('to', 'toList');

  /* ---------- flight number lookup ---------- */
  function parseFlight(txt) {
    const s = txt.trim().toUpperCase().replace(/\s+/g, '');
    let m = s.match(/^([A-Z0-9]{2})(\d{1,4})[A-Z]?$/);
    if (m && /[A-Z]/.test(m[1])) { // IATA designator
      const al = window.AIRLINES[m[1]];
      return { iata: m[1], num: String(+m[2]), icao: al && al[0], airline: al && al[1], display: m[1] + ' ' + (+m[2]) };
    }
    m = s.match(/^([A-Z]{3})(\d{1,4})[A-Z]?$/);
    if (m) return { icao: m[1], num: String(+m[2]), display: m[1] + m[2] };
    return null;
  }
  const updateGoogle = () => {
    const f = parseFlight($('flightNo').value);
    $('googleLink').href = 'https://www.google.com/search?q=' + encodeURIComponent('flight ' + (f ? f.iata ? f.iata + f.num : f.icao + f.num : $('flightNo').value));
  };
  $('flightNo').addEventListener('input', updateGoogle); updateGoogle();

  function msg(text, isErr) { const el = $('lookupMsg'); el.textContent = text; el.className = 'msg' + (isErr ? ' err' : ''); }

  async function fetchJson(url, opts) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(to); }
  }

  const toLocalInput = (s) => (s ? s.replace(' ', 'T').slice(0, 16) : '');

  async function lookupAeroDataBox(f, date, key) {
    const code = (f.iata || f.icao) + f.num;
    const data = await fetchJson(`https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(code)}/${date}?withAircraftImage=false&withLocation=false`,
      { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' } });
    const fl = Array.isArray(data) ? data[0] : data;
    if (!fl || !fl.departure || !fl.arrival) return null;
    const t = (leg) => toLocalInput((leg.scheduledTime && leg.scheduledTime.local) || leg.scheduledTimeLocal || '');
    return {
      from: fl.departure.airport && fl.departure.airport.iata, to: fl.arrival.airport && fl.arrival.airport.iata,
      dep: t(fl.departure), arr: t(fl.arrival), source: 'AeroDataBox',
    };
  }

  async function lookupRoute(f) {
    const tries = [f.icao && f.icao + f.num, f.iata && f.iata + f.num].filter(Boolean);
    for (const cs of tries) {
      try {
        const d = await fetchJson('https://api.adsbdb.com/v0/callsign/' + encodeURIComponent(cs));
        const r = d && d.response && d.response.flightroute;
        if (r && r.origin && r.destination) {
          return { from: r.origin.iata_code, to: r.destination.iata_code, source: 'adsbdb route database' };
        }
      } catch (e) { /* try next */ }
    }
    return null;
  }

  $('lookup').addEventListener('click', async () => {
    const f = parseFlight($('flightNo').value);
    if (!f) return msg('Enter a flight number like “EK 203” or “UAE203”.', true);
    const date = $('flightDate').value;
    if (!date) return msg('Choose the departure date.', true);
    $('lookup').disabled = true; msg('Looking up ' + f.display + '…');
    try {
      let res = null; const key = $('apiKey').value.trim();
      if (key) { try { res = await lookupAeroDataBox(f, date, key); } catch (e) { msg('Schedule API failed (' + e.message + '); trying route database…', true); } }
      if (!res) res = await lookupRoute(f);
      if (!res) {
        msg('Couldn’t find that flight automatically. Use “Check on Google”, then enter the airports and local times below.', true);
        return;
      }
      const okFrom = res.from && setAirport($('from'), res.from), okTo = res.to && setAirport($('to'), res.to);
      if (res.dep) $('depTime').value = res.dep;
      if (res.arr) { $('arrTime').value = res.arr; $('arrTime').dataset.auto = ''; }
      let text = `Found via ${res.source}: ${res.from || '?'} → ${res.to || '?'}` + (f.airline ? ' · ' + f.airline : '') + '. ';
      if (!res.dep || !res.arr) text += 'Enter your departure time (local) and the arrival time will be estimated — or add an API key under Advanced options for exact schedules.';
      else text += 'Please confirm the times below.';
      if (!okFrom || !okTo) text += ' (An airport wasn’t in the built-in list — please choose it manually.)';
      msg(text); estimateArrival(); updateTakeoffRead();
    } catch (e) {
      msg('Lookup failed: ' + e.message + '. Enter the details manually below.', true);
    } finally { $('lookup').disabled = false; }
  });

  /* ---------- arrival estimate ---------- */
  function utcToLocalInput(ms, tz) { return new Date(ms + C.tzOffsetMs(ms, tz)).toISOString().slice(0, 16); }
  function estimateArrival() {
    const from = AP[$('from').dataset.iata], to = AP[$('to').dataset.iata], arr = $('arrTime');
    const m = $('depTime').value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!from || !to || !m || (arr.value && arr.dataset.auto !== '1')) return;
    const dep = C.zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], from.tz);
    const dur = (C.distanceKm(from, to) / 830) * HOUR + 35 * MIN;
    arr.value = utcToLocalInput(dep + dur, to.tz); arr.dataset.auto = '1';
    msg('Arrival time estimated from the distance (≈ ' + fmtDur(dur) + ' gate to gate). Replace it with the real scheduled arrival if you have it.');
  }
  function updateTakeoffRead() {
    const from = AP[$('from').dataset.iata], m = $('depTime').value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/), v = +$('takeoffBar').value;
    if (!from || !m) { $('takeoffRead').textContent = 'Set the departure airport and time first'; return; }
    const dep = C.zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], from.tz);
    $('takeoffRead').innerHTML = `Takeoff <b>${fmtTime(dep + v * MIN, from.tz)}</b> ${from.iata} time <small>· ${v} min after scheduled departure (${fmtTime(dep, from.tz)})</small>`;
  }
  const nudge = (d) => { const b = $('takeoffBar'); b.value = Math.max(0, Math.min(240, +b.value + d)); b.dispatchEvent(new Event('input')); };
  $('tkMinus').addEventListener('click', () => nudge(-1));
  $('tkPlus').addEventListener('click', () => nudge(1));
  ['from', 'to', 'depTime'].forEach((id) => $(id).addEventListener(id === 'depTime' ? 'change' : 'input', updateTakeoffRead));
  $('arrTime').addEventListener('input', () => { $('arrTime').dataset.auto = ''; });
  $('depTime').addEventListener('change', estimateArrival);
  ['from', 'to'].forEach((id) => $(id).addEventListener('change', estimateArrival));

  /* ---------- calculation ---------- */
  let map = null, layer = null, planeMarker = null, current = null;

  function showError(text) { const el = $('error'); el.textContent = text; el.hidden = !text; if (text) $('results').hidden = true; }

  function readInputs() {
    const from = AP[$('from').dataset.iata], to = AP[$('to').dataset.iata];
    if (!from || !to) throw new Error('Choose the departure and arrival airports from the suggestions (or type their 3-letter codes).');
    if (from.iata === to.iata) throw new Error('Departure and arrival airports are the same.');
    const parse = (v, tz, what) => {
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!m) throw new Error('Enter the ' + what + ' date and time.');
      return C.zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
    };
    const depUtc = parse($('depTime').value, from.tz, 'departure'), arrUtc = parse($('arrTime').value, to.tz, 'arrival');
    const taxiOutMin = 15, taxiInMin = 10, takeoffAfter = +$('takeoffBar').value;
    const delayMin = takeoffAfter - taxiOutMin; // bar = minutes from scheduled departure to actual takeoff
    if (arrUtc - depUtc < (taxiOutMin + taxiInMin + 20) * MIN) {
      throw new Error('The arrival time is not after the departure time once time zones are accounted for. Make sure both are LOCAL times at each airport.');
    }
    if (arrUtc - depUtc > 30 * HOUR) throw new Error('That flight would be longer than 30 hours — please check the times.');
    return {
      estimatedArrival: $('arrTime').dataset.auto === '1',
      flight: { dep: from, arr: to, depUtc: depUtc + delayMin * MIN, arrUtc: arrUtc + delayMin * MIN, delayMin, takeoffAfter, taxiOutMin, taxiInMin, cruiseFt: +$('cruiseFt').value || 35000 },
      opts: { madhhab: $('madhhab').value, method: $('method').value, highLat: $('highLat').value, altitude: $('altitude').checked },
      number: $('flightNo').value.trim(),
    };
  }

  ['takeoffBar', 'depTime', 'arrTime'].forEach((id) => $(id).addEventListener(id === 'takeoffBar' ? 'input' : 'change', () => {
    updateTakeoffRead();
    if ($('results').hidden) return;
    try { const inp = readInputs(); showError(''); calculate(inp, false); } catch (err) { showError(err.message); }
  }));

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const inp = readInputs();
      showError('');
      calculate(inp, true);
    } catch (err) { showError(err.message); }
  });

  function calculate(inp, scroll) {
    const { flight, opts } = inp;
    const state = C.flightState(flight);
    const events = C.computeEvents(state, flight.depUtc - C.PAD, flight.arrUtc + C.PAD, opts);
    const windows = C.buildWindows(events);
    const rel = C.analyseWindows(windows, flight);
    const comb = C.combiningAnalysis(windows, flight, opts.madhhab);
    current = { inp, state, events, windows, rel, comb };
    $('results').hidden = false; // must be visible before the map is sized
    renderSummary(); renderPrayers(); renderCombining(); renderMap();
    if (scroll) $('summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- rendering helpers ---------- */
  const T = () => C.flightTimes(current.inp.flight);
  const both = (ms) => {
    const f = current.inp.flight;
    return `<span>${fmtTime(ms, f.dep.tz)} <small>${f.dep.iata}</small></span><span>${fmtTime(ms, f.arr.tz)} <small>${f.arr.iata}</small></span>`;
  };
  function offsetText(ms) {
    const { takeoff, landing } = T();
    if (ms < takeoff) return `${fmtDur(takeoff - ms)} before takeoff`;
    if (ms > landing) return `${fmtDur(ms - landing)} after landing`;
    return `T+${fmtDur(ms - takeoff)} after takeoff · ${fmtDur(landing - ms)} before landing`;
  }

  function renderSummary() {
    const { inp } = current, f = inp.flight, { takeoff, landing } = T();
    const km = C.distanceKm(f.dep, f.arr), airH = (landing - takeoff) / HOUR, kmh = km / airH;
    const est = inp.estimatedArrival ? ' – estimated' : '';
    const warn = kmh < 250 || kmh > 1050
      ? `<div class="warn">⚠️ The distance (${Math.round(km)} km) and the airborne time (${fmtDur(landing - takeoff)}) imply an average of ${Math.round(kmh)} km/h, which is unusual. Double-check the airports and that the times are local to each airport.</div>` : '';
    $('summary').innerHTML = `
      <div class="route">${esc(inp.number ? inp.number.toUpperCase() + ' · ' : '')}${f.dep.iata} → ${f.arr.iata}</div>
      <div class="note">${esc(f.dep.name)} → ${esc(f.arr.name)}</div>
      <div class="stats">
        <div class="stat"><small>Takeoff (${f.dep.iata})</small><strong>${fmtTime(takeoff, f.dep.tz)}</strong></div>
        <div class="stat"><small>Landing (${f.arr.iata})${est}</small><strong>${fmtTime(landing, f.arr.tz)}</strong></div>
        <div class="stat"><small>Time in the air${est}</small><strong>${fmtDur(landing - takeoff)}</strong></div>
        <div class="stat"><small>Distance</small><strong>${Math.round(km).toLocaleString()} km</strong></div>
      </div>
      ${warn}`;
  }

  function adviceFor(w) {
    const lab = LABEL[w.prayer], { takeoff, landing } = T();
    const f = current.inp.flight;
    if (!w.inFlight) {
      if (w.end <= takeoff) return `The ${lab} window closes before takeoff — pray at the departure airport (before boarding).`;
      return `${lab} begins after you land (${fmtTime(w.start, f.arr.tz)} ${f.arr.iata}) — pray at the destination.`;
    }
    const parts = [];
    if (w.opensBeforeTakeoff && w.closesAfterLanding) {
      parts.push(`The ${lab} window is open for the entire flight. You can pray at ${f.dep.iata} before takeoff, at ${f.arr.iata} after landing (${fmtDur(w.groundAfterMs)} left), or at any time in the air.`);
    } else if (w.opensBeforeTakeoff) {
      parts.push(`The ${lab} window is already open at takeoff and closes in flight at T+${fmtDur(w.endSinceTakeoffMs)} (${fmtDur(w.endBeforeLandingMs)} before landing). Pray at the airport before takeoff, or in flight before then.`);
    } else if (w.closesAfterLanding) {
      parts.push(`${lab} opens in flight at T+${fmtDur(w.sinceTakeoffMs)} (${fmtDur(w.beforeLandingMs)} before landing). It stays open for ${fmtDur(w.groundAfterMs)} after landing, so you may also pray after arriving.`);
    } else {
      parts.push(`${lab} opens at T+${fmtDur(w.sinceTakeoffMs)} and closes at T+${fmtDur(w.endSinceTakeoffMs)} — it falls entirely in flight, so plan to pray in the air.`);
    }
    return parts.join(' ');
  }

  function renderPrayers() {
    const { rel } = current, { takeoff, landing } = T(), f = current.inp.flight;
    if (!rel.length) { $('prayers').innerHTML = '<p class="note">No prayer windows overlap this flight.</p>'; return; }
    const sorted = rel.slice().sort((a, b) => a.start - b.start);
    $('prayers').innerHTML = sorted.map((w) => {
      const air = w.inFlight, ev = w.startEvent, qev = air && ev.t > takeoff && ev.t < landing ? ev : null;
      const chip = !air ? '<span class="chip">On the ground</span>'
        : w.opensBeforeTakeoff || w.closesAfterLanding ? '<span class="chip air">Spans takeoff/landing</span>' : '<span class="chip air">In flight</span>';
      const q = air ? (() => {
        const mid = w.inFlight.from; const s = current.state(mid);
        const b = C.qiblaFrom(s);
        return `<div class="qibla">🕋 Qibla at ${fmtTime(mid, f.dep.tz)} ${f.dep.iata} time: ${Math.round(b)}° (${compass(b)}) from true north${qev ? '' : ''}</div>`;
      })() : '';
      return `<div class="prayer" style="--c:${COLORS[w.prayer]}">
        <header><h3>${LABEL[w.prayer]}</h3>${chip}</header>
        <div class="kv">
          <div><span>Starts</span>${both(w.start)}${w.startEvent.adjusted ? '<span class="adj">adjusted (high-latitude rule)</span>' : ''}</div>
          <div><span></span><span class="off">${offsetText(w.start)}</span></div>
          <div><span>Ends</span>${both(w.end)}${w.endEvent.adjusted ? '<span class="adj">adjusted</span>' : ''}</div>
          <div><span></span><span class="off">${offsetText(w.end)}</span></div>
        </div>
        <p class="advice">${esc(adviceFor(w))}</p>${q}
      </div>`;
    }).join('') + `<p class="note">The sun’s position is computed for the aircraft’s location at each moment, so these differ from the ground timetable of either city. Sunrise/sunset${current.inp.opts.altitude ? ' include the extra horizon dip from cruising altitude (the sun stays visible longer at altitude)' : ' use sea-level horizon'}.</p>`;
  }

  function renderCombining() {
    const { comb, inp } = current, f = inp.flight, md = comb.md, r = comb.ruling, hanafi = inp.opts.madhhab === 'hanafi';
    const span = (o) => {
      if (!o) return '';
      const bits = [];
      if (o.onGroundBefore) bits.push(`on the ground at ${f.dep.iata} until takeoff`);
      if (o.inFlight) bits.push(`in flight from T+${fmtDur(o.inFlight.from - T().takeoff)} to T+${fmtDur(o.inFlight.to - T().takeoff)}`);
      if (o.onGroundAfter) bits.push(`on the ground at ${f.arr.iata} after landing`);
      if (bits.length) return bits.join('; ');
      return o.end <= T().takeoff ? 'already over before takeoff' : 'only begins after landing';
    };
    const pairs = comb.pairs.map((p) => {
      const l1 = LABEL[p.first], l2 = LABEL[p.second];
      let body;
      if (hanafi) {
        body = `<div class="opt"><b>Apparent combining (jam‘ ṣūrī)</b>: pray ${l1} at the very end of its time and ${l2} as soon as it begins. The boundary is <span class="off">${fmtTime(p.boundary, f.dep.tz)} ${f.dep.iata} time · ${offsetText(p.boundary)}</span>.${p.boundaryInFlight ? '' : ' (This boundary is on the ground, not in flight.)'}</div>
          <div class="opt note">Each prayer is still prayed in its own time. ${l1} window: ${span(p.taqdim)}. ${l2} window: ${span(p.takhir)}.</div>`;
      } else {
        body = `<div class="opt"><b>Early (taqdim)</b>: both in ${l1}’s time (${fmtTime(p.w1.start, f.dep.tz)}–${fmtTime(p.w1.end, f.dep.tz)} ${f.dep.iata}) → ${span(p.taqdim)}.</div>
          <div class="opt"><b>Late (ta’khir)</b>: both in ${l2}’s time (${fmtTime(p.w2.start, f.dep.tz)}–${fmtTime(p.w2.end, f.dep.tz)} ${f.dep.iata}) → ${span(p.takhir)}.</div>`;
      }
      return `<div class="pair"><h3>${p.label}</h3>${body}</div>`;
    }).join('') || '<p class="note">Neither Dhuhr/Asr nor Maghrib/Isha pairs fall within this trip.</p>';
    $('combining').innerHTML = `
      <h2>Combining &amp; shortening — ${esc(md.name)}</h2>
      <p>${comb.travelOk
        ? `<span class="ok">✔ Qualifies as travel</span> — ${Math.round(comb.km).toLocaleString()} km is at or above the ${md.qasrKm} km threshold used for ${esc(md.name)}.`
        : `<span class="no">✖ May not qualify</span> — ${Math.round(comb.km)} km is below the ${md.qasrKm} km threshold used for ${esc(md.name)}, so travel concessions may not apply.`}</p>
      <p class="note">${esc(r.summary)}</p>
      <p class="note">${esc(r.qasr)}</p>
      ${pairs}
      <p class="note">Travel concessions are generally understood to begin once you have left your town’s limits. Opinions differ on details (and on flights in particular), so please consult a scholar you trust.</p>`;
  }

  /* ---------- map ---------- */
  function unwrapPath(f, n) {
    const pts = []; let prev = null;
    for (let i = 0; i <= n; i++) {
      const p = C.gcPoint(f.dep, f.arr, i / n); let lon = p.lon;
      if (prev !== null) lon += 360 * Math.round((prev - lon) / 360);
      pts.push([p.lat, lon]); prev = lon;
    }
    return pts;
  }
  const lonNear = (lon, ref) => lon + 360 * Math.round((ref - lon) / 360);

  function renderMap() {
    const f = current.inp.flight, { takeoff, landing } = T();
    $('legend').innerHTML = Object.keys(COLORS).map((k) => `<span><i style="background:${COLORS[k]}"></i>${LABEL[k]}</span>`).join('') + '<span><b style="color:#e53935">▲</b> Plane</span><span><b style="color:#1b9e5a">➜🕋</b> Qibla direction</span>';
    if (typeof L === 'undefined') { $('map').innerHTML = '<p class="note" style="padding:12px">The map could not load (Leaflet unavailable). Prayer times above are unaffected.</p>'; return; }
    if (!map) {
      map = L.map('map', { worldCopyJump: true, minZoom: 1 });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 12 }).addTo(map);
    }
    if (layer) layer.remove();
    layer = L.layerGroup().addTo(map);
    const path = unwrapPath(f, 200);
    L.polyline(path, { color: '#0f6b63', weight: 3, opacity: .9 }).addTo(layer);
    const at = (frac, lat, lon) => { const idx = Math.round(frac * 200); return [lat, lonNear(lon, path[Math.max(0, Math.min(200, idx))][1])]; };
    [[f.dep, 0], [f.arr, 1]].forEach(([a, fr]) => {
      L.circleMarker(at(fr, a.lat, a.lon), { radius: 7, color: '#fff', weight: 2, fillColor: '#0f3d3e', fillOpacity: 1 }).addTo(layer).bindTooltip(`${a.iata} — ${a.city}`, { permanent: true, direction: 'top' });
    });
    current.events.filter((e) => e.t > takeoff && e.t < landing).forEach((e) => {
      const pos = at(e.frac, e.lat, e.lon);
      const icon = L.divIcon({ className: '', html: `<div class="dot" style="width:16px;height:16px;background:${COLORS[e.type]}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
      L.marker(pos, { icon }).addTo(layer).bindPopup(`<b>${LABEL[e.type]}</b><br>${fmtTime(e.t, f.dep.tz)} ${f.dep.iata} · ${fmtTime(e.t, f.arr.tz)} ${f.arr.iata}<br>T+${fmtDur(e.t - takeoff)} (${fmtDur(landing - e.t)} before landing)<br>Qibla ${Math.round(e.qibla)}° ${compass(e.qibla)}${e.adjusted ? '<br><i>high-latitude adjusted</i>' : ''}`);
    });
    planeMarker = L.marker(path[0], { icon: L.divIcon({ className: '', html: '<div class="pm"><div class="qarrow"><div class="shaft"></div><div class="head"></div><div class="kaaba">🕋</div></div><div class="plane">▲</div></div>', iconSize: [130, 130], iconAnchor: [65, 65] }), zIndexOffset: 1000 }).addTo(layer);
    map.invalidateSize();
    map.fitBounds(L.latLngBounds(path), { padding: [30, 30] });
    setTimeout(() => { map.invalidateSize(); map.fitBounds(L.latLngBounds(path), { padding: [30, 30] }); }, 300);
    current.path = path;
    $('scrubber').value = 0; scrub();
  }

  function scrub() {
    if (!current || !current.path) return;
    const f = current.inp.flight, { takeoff, landing } = T();
    const frac = $('scrubber').value / 1000, t = takeoff + frac * (landing - takeoff);
    const s = current.state(t), sun = C.sunAt(t, s.lat, s.lon), q = C.qiblaFrom(s);
    const path = current.path, i = Math.min(200, Math.round(s.frac * 200));
    const pos = [s.lat, lonNear(s.lon, path[i][1])];
    if (planeMarker) {
      planeMarker.setLatLng(pos);
      const nxt = C.gcPoint(f.dep, f.arr, Math.min(1, s.frac + 0.01)), prv = C.gcPoint(f.dep, f.arr, Math.max(0, s.frac - 0.01));
      const root = planeMarker.getElement();
      const pl = root && root.querySelector('.plane'), qa = root && root.querySelector('.qarrow');
      if (pl) pl.style.transform = `rotate(${C.bearing(prv, nxt)}deg)`;
      if (qa) qa.style.transform = `rotate(${q}deg)`;
    }
    const w = current.windows.find((x) => x.start <= t && t < x.end);
    const nowTxt = w ? `${LABEL[w.prayer]} time (until T+${fmtDur(w.end - takeoff)})` : 'No prayer time currently (between Sunrise and Dhuhr)';
    $('scrubInfo').innerHTML = `
      <div><b>T+${fmtDur(t - takeoff)}</b> · ${fmtDur(landing - t)} to landing</div>
      <div>${fmtTime(t, f.dep.tz)} ${f.dep.iata} time · ${fmtTime(t, f.arr.tz)} ${f.arr.iata} time</div>
      <div>${s.lat.toFixed(1)}°, ${s.lon.toFixed(1)}° · ${Math.round(s.alt / 0.3048).toLocaleString()} ft · Sun ${sun.alt.toFixed(0)}° ${sun.alt > 0 ? 'above' : 'below'} horizon</div>
      <div>🕌 Now: <b>${esc(nowTxt)}</b></div>
      <div>🕋 Qibla: <span class="compass" style="transform:rotate(${q}deg)">⬆</span> ${Math.round(q)}° ${compass(q)} (from true north)</div>`;
  }
  $('scrubber').addEventListener('input', scrub);
})();
