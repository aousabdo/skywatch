// Skywatch ingest pipeline.
//
//   data/raw/faa/*.xlsx  (FAA UAS Sightings, public records)
//   data/geo/us_places.json  (slim US Census Gazetteer: place -> lat/lon)
//   scripts/aliases.json  (curated placements for non-standard FAA labels)
//        |
//        v
//   public/data/sightings.json  (the atlas dataset the app loads)
//
// Geocoding precision is recorded per record and never invented:
//   "city"  exact match to a Census place centroid
//   "alias" curated metro/airport/neighborhood centroid (see aliases.json)
//   "state" fallback to state internal point (city not resolvable)
// Records whose state is outside the US/territories are dropped and counted.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as XLSX from "xlsx";
import {
  STATE_ABBR, STATE_CENTROID, normCity, parseNarrative, parseDate,
} from "./lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FAA_DIR = join(ROOT, "data/raw/faa");
const OUT = join(ROOT, "public/data/sightings.json");

const places = JSON.parse(readFileSync(join(ROOT, "data/geo/us_places.json"), "utf8"));
const aliases = JSON.parse(readFileSync(join(__dirname, "aliases.json"), "utf8"));

function findCol(headerRow, ...names) {
  const lower = headerRow.map((h) => String(h ?? "").trim().toLowerCase());
  for (const n of names) {
    const i = lower.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

const sightings = [];
const stats = {
  files: 0, rows: 0,
  geocoded: { city: 0, alias: 0, state: 0 },
  dropped: { noDate: 0, noPlace: 0, foreignState: 0 },
  unmatchedCities: new Map(),
};

const files = readdirSync(FAA_DIR).filter((f) => f.toLowerCase().endsWith(".xlsx")).sort();
for (const file of files) {
  stats.files++;
  const wb = XLSX.read(readFileSync(join(FAA_DIR, file)), { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  if (!grid.length) continue;

  const header = grid[0];
  const ci = {
    date: findCol(header, "date", "day of sighting", "date of sighting"),
    state: findCol(header, "state"),
    city: findCol(header, "city"),
    summary: findCol(header, "summary"),
  };

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.every((v) => v == null || v === "")) continue;

    const rawState = ci.state >= 0 ? row[ci.state] : null;
    const rawCity = ci.city >= 0 ? row[ci.city] : null;
    if (!rawState || !rawCity) continue;
    stats.rows++;

    const date = parseDate(ci.date >= 0 ? row[ci.date] : null);
    if (!date) { stats.dropped.noDate++; continue; }

    const stateName = String(rawState).toUpperCase().trim();
    const cityName = String(rawCity).toUpperCase().trim();
    const abbr = STATE_ABBR[stateName];

    // Geocode: alias -> gazetteer -> state centroid.
    let lat = null, lon = null, precision = null;
    const aliasHit = aliases[`${stateName}|${cityName}`];
    if (Array.isArray(aliasHit)) {
      [lat, lon] = aliasHit; precision = "alias";
    } else if (abbr) {
      const gz = places[`${abbr}|${normCity(cityName)}`];
      if (gz) {
        [lat, lon] = gz; precision = "city";
      } else if (STATE_CENTROID[abbr]) {
        [lat, lon] = STATE_CENTROID[abbr]; precision = "state";
        const key = `${stateName} / ${cityName}`;
        stats.unmatchedCities.set(key, (stats.unmatchedCities.get(key) ?? 0) + 1);
      }
    }

    if (!abbr) { stats.dropped.foreignState++; continue; }
    if (lat == null) { stats.dropped.noPlace++; continue; }

    stats.geocoded[precision]++;
    const summary = ci.summary >= 0 ? String(row[ci.summary] ?? "") : "";
    const n = parseNarrative(summary);

    sightings.push({
      id: sightings.length,
      d: date,
      s: abbr,
      c: cityName,
      lat, lon,
      p: precision,
      alt: n.altitudeFt,
      ev: n.evasive === null ? null : n.evasive ? 1 : 0,
      t: n.incidentType,
      k: n.uasKind,
      n: summary,
    });
  }
}

sightings.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
sightings.forEach((s, i) => (s.id = i));

const dates = sightings.map((s) => s.d);
const byState = {};
const byMonth = {};
for (const s of sightings) {
  byState[s.s] = (byState[s.s] ?? 0) + 1;
  const ym = s.d.slice(0, 7);
  byMonth[ym] = (byMonth[ym] ?? 0) + 1;
}

const out = {
  meta: {
    source: "FAA UAS Sightings Reports (public records)",
    sourceUrl: "https://www.faa.gov/uas/resources/public_records/uas_sightings_report",
    generated: new Date().toISOString(),
    count: sightings.length,
    dateMin: dates[0] ?? null,
    dateMax: dates[dates.length - 1] ?? null,
    geocoding: {
      note: "Points are positioned at city/metro centroids, not exact incident coordinates. The FAA public records contain only date, state, city, and a narrative — no coordinates.",
      city: stats.geocoded.city,
      alias: stats.geocoded.alias,
      state: stats.geocoded.state,
    },
    dropped: stats.dropped,
    byState,
    byMonth,
  },
  sightings,
};

writeFileSync(OUT, JSON.stringify(out));

// Console report.
const total = stats.geocoded.city + stats.geocoded.alias + stats.geocoded.state;
const pct = (n) => `${((100 * n) / total).toFixed(1)}%`;
console.log(`\nSkywatch ingest`);
console.log(`  files            ${stats.files}`);
console.log(`  rows (city+state)${String(stats.rows).padStart(6)}`);
console.log(`  emitted          ${String(total).padStart(6)}`);
console.log(`  geocode city     ${String(stats.geocoded.city).padStart(6)}  ${pct(stats.geocoded.city)}`);
console.log(`  geocode alias    ${String(stats.geocoded.alias).padStart(6)}  ${pct(stats.geocoded.alias)}`);
console.log(`  geocode state    ${String(stats.geocoded.state).padStart(6)}  ${pct(stats.geocoded.state)}  (fallback)`);
console.log(`  dropped noDate   ${String(stats.dropped.noDate).padStart(6)}`);
console.log(`  dropped foreign  ${String(stats.dropped.foreignState).padStart(6)}`);
console.log(`  dropped noPlace  ${String(stats.dropped.noPlace).padStart(6)}`);
console.log(`  date range       ${out.meta.dateMin} -> ${out.meta.dateMax}`);
const top = [...stats.unmatchedCities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
if (top.length) {
  console.log(`\n  top state-fallback labels (add to aliases.json to refine):`);
  for (const [k, n] of top) console.log(`    ${String(n).padStart(4)}  ${k}`);
}
console.log(`\n  wrote ${OUT}`);
