// Enrich each sighting with its distance to the nearest military installation.
//
//   public/data/sightings.json  (from ingest)
//   public/data/overlays/military.json  (base polygons, with stable id)
//        |
//        v  adds per sighting:  nb = nearest base id, nd = distance in nm
//   public/data/sightings.json  (rewritten in place)
//
// Distance is point-to-polygon: 0 if the (city-centroid) sighting falls inside a
// base footprint, otherwise the great-circle distance to the nearest boundary
// edge. Using the polygon — not the centroid — keeps large installations
// (Fort Irwin, Edwards, NTC) honest. Run after `ingest` and `build-overlays`.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SIGHTINGS = join(ROOT, "public/data/sightings.json");
const MILITARY = join(ROOT, "public/data/overlays/military.json");

const NM_PER_DEG_LAT = 60; // 1 arc-minute of latitude ≈ 1 nautical mile

// Local equirectangular scaling around a latitude: distances in nm.
function makeScaler(lat0) {
  const kx = NM_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  const ky = NM_PER_DEG_LAT;
  return (lon, lat) => [lon * kx, lat * ky];
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Minimum distance (nm) from a point to a (multi)polygon; 0 if inside.
function distToPolygon(lon, lat, polys) {
  const scale = makeScaler(lat);
  const [px, py] = scale(lon, lat);
  let min = Infinity;
  for (const poly of polys) {
    // poly[0] is the outer ring; poly[1..] are holes.
    const outer = poly[0];
    if (pointInRing(lon, lat, outer)) {
      let inHole = false;
      for (let h = 1; h < poly.length; h++) if (pointInRing(lon, lat, poly[h])) { inHole = true; break; }
      if (!inHole) return 0;
    }
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, ay] = scale(ring[i][0], ring[i][1]);
        const [bx, by] = scale(ring[i + 1][0], ring[i + 1][1]);
        const d = distToSegment(px, py, ax, ay, bx, by);
        if (d < min) min = d;
      }
    }
  }
  return min;
}

// Bounding box per base for a cheap pre-filter (skip far polygons fast).
function bbox(polys) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
    if (x < minLon) minLon = x; if (x > maxLon) maxLon = x;
    if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
  }
  return [minLon, minLat, maxLon, maxLat];
}

const data = JSON.parse(readFileSync(SIGHTINGS, "utf8"));
const mil = JSON.parse(readFileSync(MILITARY, "utf8"));

const bases = mil.features.map((f) => {
  const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
  return { id: f.properties.id, polys, bb: bbox(polys) };
});

// Only consider bases whose bbox is within this many degrees of the sighting.
const PREFILTER_DEG = 1.5; // ~90 nm latitude

const hist = { "<=5": 0, "<=10": 0, "<=25": 0, "<=50": 0, ">50": 0 };
const baseHitsAll = new Map();

for (const s of data.sightings) {
  let best = Infinity, bestId = null;
  const cosLat = Math.cos((s.lat * Math.PI) / 180) || 1;
  for (const b of bases) {
    const [mnLon, mnLat, mxLon, mxLat] = b.bb;
    // cheap reject: bbox margin in degrees (longitude widened by 1/cosLat)
    const mLon = PREFILTER_DEG / cosLat;
    if (s.lon < mnLon - mLon || s.lon > mxLon + mLon || s.lat < mnLat - PREFILTER_DEG || s.lat > mxLat + PREFILTER_DEG) continue;
    const d = distToPolygon(s.lon, s.lat, b.polys);
    if (d < best) { best = d; bestId = b.id; }
  }
  if (bestId === null) { s.nb = null; s.nd = null; continue; }
  s.nb = bestId;
  s.nd = Math.round(best * 10) / 10;
  if (best <= 5) hist["<=5"]++;
  else if (best <= 10) hist["<=10"]++;
  else if (best <= 25) hist["<=25"]++;
  else if (best <= 50) hist["<=50"]++;
  else hist[">50"]++;
  if (best <= 10) baseHitsAll.set(bestId, (baseHitsAll.get(bestId) ?? 0) + 1);
}

data.meta.proximity = {
  note: "Each sighting's nd is the great-circle distance (nm) from its city/metro centroid to the nearest military-installation boundary; nb is that base's id. Hotspots are computed client-side over the selected time window.",
  source: "HIFLD USA Military Bases",
};

writeFileSync(SIGHTINGS, JSON.stringify(data));

// Report.
const baseName = new Map(mil.features.map((f) => [f.properties.id, f.properties.name]));
console.log("Skywatch proximity enrichment");
console.log(`  sightings        ${data.sightings.length}`);
for (const k of Object.keys(hist)) console.log(`  ${k.padEnd(5)} nm to base   ${String(hist[k]).padStart(5)}`);
const top = [...baseHitsAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(`\n  top bases by sightings within 10nm (all time):`);
for (const [bid, n] of top) console.log(`    ${String(n).padStart(4)}  ${baseName.get(bid)}`);
