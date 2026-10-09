# Flight Prayer Times

A static, mobile-friendly web app that tells Muslim travellers when each prayer falls **during a flight**.

- Enter a flight number + date (or just the airports and local times) and confirm the route and timings.
- Prayer boundaries are computed from the sun's position over the aircraft at each moment (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha).
- Shows each time as clock time at both airports **and** as "T+4h 10m after takeoff" / "2h 05m before landing".
- Madhhab or fiqh (Hanafi, Maliki, Shafi'i, Hanbali, Ja'fari) sets the Asr shadow factor and the combining/qasr guidance.
- 14 calculation methods, high-latitude fallback rules, and optional cruise-altitude horizon dip for sunrise/sunset.
- Combining check: Dhuhr+Asr and Maghrib+Isha windows (taqdim/ta'khir, or Hanafi apparent combining) mapped onto the flight.
- Leaflet map with the great-circle path, prayer markers, and a slider that moves a plane along the route with live sun altitude and Qibla bearing.

## Run / host

No build step. Serve the folder with any static host (GitHub Pages, Netlify, `python3 -m http.server`) or open `index.html` directly.

## Flight lookup

Browsers cannot scrape Google, and no free schedule API works without a key, so:

1. **Route only (no key):** uses the free adsbdb callsign database to fill origin/destination.
2. **Full schedule (optional):** paste an [AeroDataBox](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) RapidAPI key under *Advanced flight options*; it is stored only in your browser's localStorage.
3. **Manual:** the "Check on Google" button opens a search for the flight; copy the airports and local times in.

## Data and tests

`tools/build-airports.js` (OurAirports + `tz-lookup`) regenerates `js/airports.js`; `tools/build-airlines.py` regenerates `js/airlines.js` from OpenFlights. Ground-time output of `js/core.js` was checked against the `adhan` library (within about 1 minute).

## Disclaimer

Estimates only. Rulings on combining and shortening differ between scholars; consult one you trust.
