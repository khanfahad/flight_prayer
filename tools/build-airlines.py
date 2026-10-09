"""Builds js/airlines.js from OpenFlights airlines.dat (pass its path). Airports: see build-airports.js."""
import csv, json, sys
al_path = sys.argv[1]
airlines = {}
for r in csv.reader(open(al_path, encoding="utf-8")):
    _id, name, _alias, iata, icao, _cs, _c, active = r
    if active == "Y" and len(iata) == 2 and len(icao) == 3 and iata != "\\N":
        airlines.setdefault(iata, [icao, name])
open("js/airlines.js", "w", encoding="utf-8").write(
    "// IATA -> [ICAO, name] - generated from OpenFlights by tools/build-data.py\n"
    "window.AIRLINES=" + json.dumps(airlines, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(len(airlines))
