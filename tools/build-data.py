"""Builds js/airports.js and js/airlines.js from OpenFlights data (pass the two .dat paths)."""
import csv, json, sys
ap_path, al_path = sys.argv[1], sys.argv[2]
airports = []
for r in csv.reader(open(ap_path, encoding="utf-8")):
    _id, name, city, country, iata, icao, lat, lon, alt, _o, _d, tz, typ, _s = r
    if typ != "airport" or iata in ("", "\\N") or tz in ("", "\\N"):
        continue
    airports.append([iata, name, city, country, round(float(lat), 4), round(float(lon), 4), int(float(alt) * 0.3048), tz])
airports.sort(key=lambda a: a[0])
open("js/airports.js", "w", encoding="utf-8").write(
    "// [iata, name, city, country, lat, lon, elevation_m, tz] - generated from OpenFlights by tools/build-data.py\n"
    "window.AIRPORTS=" + json.dumps(airports, ensure_ascii=False, separators=(",", ":")) + ";\n")
airlines = {}
for r in csv.reader(open(al_path, encoding="utf-8")):
    _id, name, _alias, iata, icao, _cs, _c, active = r
    if active == "Y" and len(iata) == 2 and len(icao) == 3 and iata != "\\N":
        airlines.setdefault(iata, [icao, name])
open("js/airlines.js", "w", encoding="utf-8").write(
    "// IATA -> [ICAO, name] - generated from OpenFlights by tools/build-data.py\n"
    "window.AIRLINES=" + json.dumps(airlines, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(len(airports), len(airlines))
