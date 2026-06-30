# Skywatch — Counter-UAS Incident Atlas

A public-data atlas of UAS (drone) sightings, built for operators. Skywatch maps
every FAA-logged UAS sighting from the public records onto a single chronological
and geospatial view — the join of the CONUS drone-incident universe that the
FAA's own tools and academic dashboards don't provide.

**Built by [OCEANS LLC](https://oceansllc.com).**

## What it shows

- Every UAS sighting in the FAA public records (FY2020 – present), clustered on a
  dark vector map.
- A time scrubber (default: last 90 days) over a monthly histogram of activity.
- **Critical-infrastructure overlays:** 654 military installations (HIFLD,
  branch-classified footprints) and 917 US airports (OurAirports), toggleable.
- **Proximity alerts:** sightings within a selectable radius (5 / 10 / 25 nm) of a
  military installation glow red and pulse; a side panel ranks the top-25
  installations by nearby-sighting volume in the current time window, and the
  view flies to any installation you click.
- Click any sighting for the original FAA narrative, reported altitude, incident
  class, UAS descriptor, and distance to the nearest installation.

Proximity is **colocation, not confirmed incursion**: because sightings are placed
at city/metro centroids, "near a base" is heavily influenced by urban bases (Fort
Hamilton in NYC, Fort McPherson in Atlanta). The panel ranks proximity for an
operator to judge — it does not assert intent.

## Honest geocoding

The FAA public records contain **only date, state, city, and a narrative — no
coordinates.** Skywatch geocodes each sighting to a centroid and records the
precision of every placement, which is shown in each popup:

| Precision | Meaning | Share |
|-----------|---------|-------|
| `city`    | Exact match to a US Census Gazetteer place centroid | ~91% |
| `alias`   | Curated metro / airport / neighborhood centroid (see `scripts/aliases.json`) | ~6% |
| `state`   | Fallback to the state internal point (city not resolvable) | ~2% |

Nothing is placed at a fabricated precise location. Every non-standard placement
is an explicit, auditable entry in `scripts/aliases.json`.

## Data sources

- **FAA UAS Sightings Reports** (public records) —
  <https://www.faa.gov/uas/resources/public_records/uas_sightings_report>
- **US Census Bureau Gazetteer**, Places (public domain), for geocoding.

## Develop

```bash
npm install
npm run data      # ingest FAA + enrich each sighting with nearest-base distance
npm run dev       # http://localhost:5173
```

`npm run data` runs `ingest` (FAA XLSX → `sightings.json`) then `enrich`
(adds each sighting's distance to the nearest military-installation boundary).
The infrastructure overlays are prebuilt and committed; regenerate them with
`npm run fetch-overlays && npm run build-overlays`.

### Refresh the FAA data

```bash
npm run fetch-faa # re-download the quarterly XLSX into data/raw/faa
npm run ingest    # rebuild the dataset
```

## Build & deploy

```bash
npm run build     # -> dist/
```

- **Cloudflare Pages** — connect the repo, build command `npm run build`, output
  directory `dist`. Base path is `/`.
- **GitHub Pages** — push to `main`; the workflow in `.github/workflows/deploy.yml`
  builds with `SKYWATCH_BASE=/skywatch/` and publishes automatically.

## Stack

Vite · TypeScript · Tailwind 4 · MapLibre GL JS · D3 v7. No backend, no login, no
paid APIs — pure static, client-side.

## License

MIT. FAA and Census source data are US Government public records / public domain.
