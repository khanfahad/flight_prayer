// Builds js/airports.js from OurAirports airports.csv (https://github.com/davidmegginson/ourairports-data).
// Time zones are derived from coordinates with the `tz-lookup` npm package.
// Usage: node tools/build-airports.js path/to/airports.csv   (run `npm i tz-lookup` somewhere on NODE_PATH)
const fs = require('fs');
const tzlookup = require('tz-lookup');
const names = new Intl.DisplayNames(['en'], { type: 'region' });

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  return rows;
}

const rows = parseCsv(fs.readFileSync(process.argv[2], 'utf8'));
const h = rows[0], ix = (n) => h.indexOf(n);
const out = [], seen = new Set();
rows.slice(1).forEach((r) => {
  const iata = r[ix('iata_code')];
  if (!iata || iata.length !== 3 || seen.has(iata)) return;
  if (!['large_airport', 'medium_airport', 'small_airport'].includes(r[ix('type')])) return;
  const lat = +r[ix('latitude_deg')], lon = +r[ix('longitude_deg')];
  let tz; try { tz = tzlookup(lat, lon); } catch (e) { return; }
  let country = r[ix('iso_country')]; try { country = names.of(country) || country; } catch (e) { /* keep code */ }
  seen.add(iata);
  out.push([iata, r[ix('name')], r[ix('municipality')], country, +lat.toFixed(4), +lon.toFixed(4), Math.round((+r[ix('elevation_ft')] || 0) * 0.3048), tz]);
});
out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
fs.writeFileSync('js/airports.js',
  '// [iata, name, city, country, lat, lon, elevation_m, tz] - generated from OurAirports by tools/build-airports.js\n' +
  'window.AIRPORTS=' + JSON.stringify(out) + ';\n');
console.log(out.length, 'airports');
