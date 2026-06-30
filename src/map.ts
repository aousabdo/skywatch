import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Sighting } from "./types";

// Key-free dark vector basemap (CARTO). Swappable for a self-hosted Protomaps
// style later without touching the data layers.
const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const SRC = "sightings";

export class SkyMap {
  readonly map: maplibregl.Map;
  private ready = false;
  private pending: GeoJSON.FeatureCollection | null = null;
  private lookup: (id: number) => Sighting | undefined = () => undefined;

  constructor(container: string) {
    this.map = new maplibregl.Map({
      container,
      style: BASEMAP,
      center: [-98.5, 39.5], // CONUS
      zoom: 3.6,
      minZoom: 2.5,
      maxZoom: 16,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    this.map.on("load", () => this.onLoad());
  }

  setSightingLookup(fn: (id: number) => Sighting | undefined) {
    this.lookup = fn;
  }

  private onLoad() {
    this.map.addSource(SRC, {
      type: "geojson",
      data: this.pending ?? { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 11,
    });

    // Cluster bubbles — cyan, scaled by count.
    this.map.addLayer({
      id: "clusters",
      type: "circle",
      source: SRC,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step", ["get", "point_count"],
          "#2C7A93", 25, "#3DB9D8", 100, "#5FD2EE", 500, "#8FE3F5",
        ],
        "circle-radius": [
          "step", ["get", "point_count"],
          14, 25, 19, 100, 26, 500, 34,
        ],
        "circle-opacity": 0.85,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#0B1F3A",
      },
    });

    this.map.addLayer({
      id: "cluster-count",
      type: "symbol",
      source: SRC,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
        "text-size": 12,
      },
      paint: { "text-color": "#0B1F3A" },
    });

    // Individual sightings — colored by geocoding precision so the honest
    // ones (exact city) read brightest and fallbacks read dimmer.
    this.map.addLayer({
      id: "point",
      type: "circle",
      source: SRC,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": [
          "match", ["get", "p"],
          "city", "#3DB9D8",
          "alias", "#3DB9D8",
          "state", "#9DB0C4",
          "#3DB9D8",
        ],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 10, 6],
        "circle-opacity": 0.9,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#0B1F3A",
      },
    });

    this.wireInteractions();
    this.ready = true;
    if (this.pending) this.setData(this.pending);
  }

  private wireInteractions() {
    this.map.on("click", "clusters", (e) => {
      const f = this.map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
      if (!f) return;
      const clusterId = f.properties!.cluster_id;
      const src = this.map.getSource(SRC) as maplibregl.GeoJSONSource;
      src.getClusterExpansionZoom(clusterId).then((zoom) => {
        const geom = f.geometry as GeoJSON.Point;
        this.map.easeTo({ center: geom.coordinates as [number, number], zoom });
      });
    });

    this.map.on("click", "point", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const s = this.lookup(f.properties!.id as number);
      if (!s) return;
      const geom = f.geometry as GeoJSON.Point;
      new maplibregl.Popup({ closeButton: true, maxWidth: "340px", offset: 10 })
        .setLngLat(geom.coordinates as [number, number])
        .setHTML(popupHtml(s))
        .addTo(this.map);
    });

    for (const layer of ["clusters", "point"]) {
      this.map.on("mouseenter", layer, () => (this.map.getCanvas().style.cursor = "pointer"));
      this.map.on("mouseleave", layer, () => (this.map.getCanvas().style.cursor = ""));
    }
  }

  setData(fc: GeoJSON.FeatureCollection) {
    if (!this.ready) {
      this.pending = fc;
      return;
    }
    (this.map.getSource(SRC) as maplibregl.GeoJSONSource).setData(fc);
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const PRECISION_LABEL: Record<string, string> = {
  city: "City centroid",
  alias: "Metro / airport centroid",
  state: "State centroid (city not resolved)",
};

function popupHtml(s: Sighting): string {
  const date = new Date(s.d + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
  const chips: string[] = [];
  if (s.t) chips.push(s.t);
  if (s.k) chips.push(s.k);
  if (s.alt != null) chips.push(`${s.alt.toLocaleString()} ft`);
  if (s.ev === 1) chips.push("Evasive action");
  const chipHtml = chips
    .map((c) => `<span style="background:#123059;color:#9DB0C4;border-radius:4px;padding:1px 7px;font-size:10px;letter-spacing:.04em">${esc(c)}</span>`)
    .join(" ");

  return `
    <div style="padding:14px 16px 16px">
      <div style="font-family:'JetBrains Mono',monospace;color:#3DB9D8;font-size:11px;letter-spacing:.08em">${esc(date)}</div>
      <div style="color:#E8EDF2;font-weight:600;font-size:15px;margin-top:2px">${esc(s.c)}, ${esc(s.s)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin:9px 0">${chipHtml}</div>
      <div style="color:#C5D2E0;font-size:11.5px;line-height:1.5;max-height:150px;overflow:auto">${esc(s.n)}</div>
      <div style="color:#5E7088;font-size:9.5px;margin-top:10px;border-top:1px solid #123059;padding-top:7px">
        ${PRECISION_LABEL[s.p] ?? s.p} · FAA UAS Sightings (public records)
      </div>
    </div>`;
}
