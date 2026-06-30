import type { Dataset, Sighting, SightingFeature } from "./types";

const MS_PER_DAY = 86_400_000;

export function epochDay(iso: string): number {
  return Math.floor(Date.parse(iso + "T00:00:00Z") / MS_PER_DAY);
}

export function dayToDate(day: number): Date {
  return new Date(day * MS_PER_DAY);
}

export async function loadDataset(base: string): Promise<Dataset> {
  const res = await fetch(`${base}data/sightings.json`);
  if (!res.ok) throw new Error(`Failed to load sightings.json: ${res.status}`);
  return res.json();
}

export async function loadGeoJSON(base: string, path: string): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

// Build the full GeoJSON feature collection once. We keep the heavy fields
// (narrative, city) out of the features and look them up by id on demand.
export function toFeatures(sightings: Sighting[]): SightingFeature[] {
  return sightings.map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    properties: { id: s.id, d: epochDay(s.d), p: s.p, s: s.s },
  }));
}

export function filterFeatures(
  features: SightingFeature[],
  minDay: number,
  maxDay: number,
  state: string,
): SightingFeature[] {
  const out: SightingFeature[] = [];
  for (const f of features) {
    const p = f.properties;
    if (p.d < minDay || p.d > maxDay) continue;
    if (state && p.s !== state) continue;
    out.push(f);
  }
  return out;
}
