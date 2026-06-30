// Shape of public/data/sightings.json, produced by scripts/ingest.mjs.

export type Precision = "city" | "alias" | "state";

export interface Sighting {
  id: number;
  d: string; // ISO date yyyy-mm-dd
  s: string; // state abbreviation
  c: string; // city (uppercase, as logged by FAA)
  lat: number;
  lon: number;
  p: Precision; // geocoding precision
  alt: number | null; // reported altitude (ft)
  ev: 0 | 1 | null; // evasive action: 0 no, 1 yes, null unknown
  t: "SIGHTING" | "INCIDENT" | null; // FAA incident class
  k: string | null; // coarse UAS descriptor when stated
  n: string; // full FAA narrative
}

export interface Dataset {
  meta: {
    source: string;
    sourceUrl: string;
    generated: string;
    count: number;
    dateMin: string;
    dateMax: string;
    geocoding: {
      note: string;
      city: number;
      alias: number;
      state: number;
    };
    dropped: Record<string, number>;
    byState: Record<string, number>;
    byMonth: Record<string, number>;
  };
  sightings: Sighting[];
}

export type SightingFeature = GeoJSON.Feature<GeoJSON.Point, {
  id: number;
  d: number; // epoch day, for fast range filtering
  p: Precision;
  s: string; // state abbreviation, for the state filter
}>;
