// Build the critical-infrastructure overlay layers from raw sources:
//
//   data/raw/overlays/airports.csv     (OurAirports, public domain)
//   data/raw/overlays/milbases.geojson (HIFLD "USA Military Bases")
//        |
//        v
//   public/data/overlays/airports.json  (US large/medium airport points)
//   public/data/overlays/military.json  (US military base polygons + centroids)
//
// Run `npm run fetch-overlays` first to (re)download the raw sources.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const RAW = join(ROOT, "data/raw/overlays");
const OUT = join(ROOT, "public/data/overlays");
mkdirSync(OUT, { recursive: true });

// --- Airports -------------------------------------------------------------

// Minimal CSV parser handling quoted fields (OurAirports quotes text columns).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function buildAirports() {
  const rows = parseCsv(readFileSync(join(RAW, "airports.csv"), "utf8"));
  const header = rows[0];
  const ix = (name) => header.indexOf(name);
  const cType = ix("type"), cName = ix("name"), cLat = ix("latitude_deg"),
    cLon = ix("longitude_deg"), cCountry = ix("iso_country"),
    cIata = ix("iata_code"), cIcao = ix("icao_code"), cMuni = ix("municipality");

  const features = [];
  let large = 0, medium = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r[cCountry] !== "US") continue;
    const type = r[cType];
    if (type !== "large_airport" && type !== "medium_airport") continue;
    const lat = Number(r[cLat]), lon = Number(r[cLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    type === "large_airport" ? large++ : medium++;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] },
      properties: {
        name: r[cName],
        muni: r[cMuni] || null,
        iata: r[cIata] || null,
        icao: r[cIcao] || null,
        size: type === "large_airport" ? "large" : "medium",
      },
    });
  }
  const fc = { type: "FeatureCollection", features };
  writeFileSync(join(OUT, "airports.json"), JSON.stringify(fc));
  return { count: features.length, large, medium };
}

// --- Military bases -------------------------------------------------------

// Collapse the HIFLD COMPONENT string to a branch for coloring/grouping.
// Values look like "AF Active", "Navy Reserve", "MC Active", "Army Guard", "WHS".
function branchOf(component) {
  const head = (component || "").trim().split(/\s+/)[0].toLowerCase();
  switch (head) {
    case "af": return "Air Force";
    case "army": return "Army";
    case "navy": return "Navy";
    case "mc": return "Marine Corps";
    case "cg": case "coast": return "Coast Guard";
    default: return "Other";
  }
}

// Area-weighted centroid of a (multi)polygon ring set — used for labels and,
// later, sighting-to-base proximity scoring.
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[i + 1];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (a === 0) return null;
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a), Math.abs(a)];
}

function polyCentroid(geom) {
  const polys = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
  let bx = 0, by = 0, bw = 0;
  for (const poly of polys) {
    const c = ringCentroid(poly[0]);
    if (!c) continue;
    bx += c[0] * c[2]; by += c[1] * c[2]; bw += c[2];
  }
  if (bw === 0) return null;
  return [Math.round((bx / bw) * 1e5) / 1e5, Math.round((by / bw) * 1e5) / 1e5];
}

function buildMilitary() {
  const src = JSON.parse(readFileSync(join(RAW, "milbases.geojson"), "utf8"));
  const features = [];
  const bases = []; // compact metadata + centroid, keyed by stable id
  const byBranch = {};
  let id = 0;
  for (const f of src.features) {
    if (!f.geometry) continue;
    const p = f.properties || {};
    const branch = branchOf(p.COMPONENT);
    byBranch[branch] = (byBranch[branch] ?? 0) + 1;
    const props = {
      id,
      name: p.SITE_NAME,
      branch,
      component: p.COMPONENT,
      state: p.STATE_TERR,
      joint: p.JOINT_BASE && p.JOINT_BASE !== "N/A" ? p.JOINT_BASE : null,
    };
    features.push({ type: "Feature", geometry: f.geometry, properties: props });
    const c = polyCentroid(f.geometry);
    bases.push({ id, name: props.name, branch, state: props.state, joint: props.joint, lon: c ? c[0] : null, lat: c ? c[1] : null });
    id++;
  }
  writeFileSync(join(OUT, "military.json"), JSON.stringify({ type: "FeatureCollection", features }));
  writeFileSync(join(OUT, "bases.json"), JSON.stringify(bases));
  return { count: features.length, byBranch };
}

const air = buildAirports();
const mil = buildMilitary();
console.log("Skywatch overlays");
console.log(`  airports  ${air.count}  (large ${air.large}, medium ${air.medium})`);
console.log(`  military  ${mil.count}  ${JSON.stringify(mil.byBranch)}`);
console.log(`  wrote ${OUT}/{airports,military,bases}.json`);
