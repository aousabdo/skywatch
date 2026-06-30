import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Sighting } from "./types";

// Key-free dark vector basemap (CARTO). Swappable for a self-hosted Protomaps
// style later without touching the data layers.
const BASEMAP = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const SRC = "sightings";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export class SkyMap {
  readonly map: maplibregl.Map;
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private isReady = false;
  private pending: GeoJSON.FeatureCollection | null = null;
  private lookup: (id: number) => Sighting | undefined = () => undefined;
  private baseLookup: (id: number | null) => string | null = () => null;
  private alertVisible = true;

  constructor(container: string) {
    this.ready = new Promise((res) => (this.resolveReady = res));
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

    this.initAlerts();
    this.wireInteractions();
    this.isReady = true;
    this.resolveReady();
    if (this.pending) this.setData(this.pending);
  }

  // Proximity-alert layer: near-base sightings rendered as red pulsing glows,
  // on top of the cyan clusters. Data is set per time-window from main.
  private initAlerts() {
    this.map.addSource("alerts", { type: "geojson", data: EMPTY });
    this.map.addLayer({
      id: "alert-halo", type: "circle", source: "alerts",
      paint: {
        "circle-color": "#E0463F",
        "circle-radius": 12,
        "circle-opacity": 0.25,
        "circle-blur": 0.6,
      },
    });
    this.map.addLayer({
      id: "alert-core", type: "circle", source: "alerts",
      paint: {
        "circle-color": "#E0463F",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 3, 10, 5.5],
        "circle-opacity": 0.95,
        "circle-stroke-color": "#1A0606",
        "circle-stroke-width": 1,
      },
    });
    this.map.on("click", "alert-core", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const s = this.lookup(f.properties!.id as number);
      if (!s) return;
      const geom = f.geometry as GeoJSON.Point;
      new maplibregl.Popup({ closeButton: true, maxWidth: "340px", offset: 10 })
        .setLngLat(geom.coordinates as [number, number])
        .setHTML(popupHtml(s, this.baseName(s.nb)))
        .addTo(this.map);
    });
    this.hoverCursor("alert-core");
    this.startPulse();
  }

  private startPulse() {
    const loop = (t: number) => {
      if (this.map.getLayer("alert-halo") && this.alertVisible) {
        const s = (Math.sin(t / 700) + 1) / 2; // 0..1
        this.map.setPaintProperty("alert-halo", "circle-radius", 11 + 13 * s);
        this.map.setPaintProperty("alert-halo", "circle-opacity", 0.32 * (1 - s) + 0.05);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
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
        .setHTML(popupHtml(s, this.baseName(s.nb)))
        .addTo(this.map);
    });

    for (const layer of ["clusters", "point"]) {
      this.map.on("mouseenter", layer, () => (this.map.getCanvas().style.cursor = "pointer"));
      this.map.on("mouseleave", layer, () => (this.map.getCanvas().style.cursor = ""));
    }
  }

  setData(fc: GeoJSON.FeatureCollection) {
    if (!this.isReady) {
      this.pending = fc;
      return;
    }
    (this.map.getSource(SRC) as maplibregl.GeoJSONSource).setData(fc);
  }

  // --- Critical-infrastructure overlays (inserted beneath the sightings) ---

  addMilitary(fc: GeoJSON.FeatureCollection) {
    if (this.map.getSource("military")) return;
    this.map.addSource("military", { type: "geojson", data: fc });
    this.map.addLayer({
      id: "military-fill", type: "fill", source: "military",
      layout: { visibility: "none" },
      paint: { "fill-color": "#C8902E", "fill-opacity": 0.14 },
    }, "clusters");
    this.map.addLayer({
      id: "military-line", type: "line", source: "military",
      layout: { visibility: "none" },
      paint: { "line-color": "#D9A646", "line-width": 1, "line-opacity": 0.7 },
    }, "clusters");

    this.map.on("click", "military-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      new maplibregl.Popup({ closeButton: true, offset: 6 })
        .setLngLat(e.lngLat)
        .setHTML(basePopup(f.properties as MilProps))
        .addTo(this.map);
    });
    this.hoverCursor("military-fill");
  }

  addAirports(fc: GeoJSON.FeatureCollection) {
    if (this.map.getSource("airports")) return;
    this.map.addSource("airports", { type: "geojson", data: fc });
    this.map.addLayer({
      id: "airports-point", type: "circle", source: "airports",
      layout: { visibility: "none" },
      paint: {
        "circle-color": "#0D2545",
        "circle-stroke-color": ["match", ["get", "size"], "large", "#9DB6CE", "#6E8CA8"],
        "circle-stroke-width": ["match", ["get", "size"], "large", 2, 1],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, ["match", ["get", "size"], "large", 3.5, 2], 10, ["match", ["get", "size"], "large", 7, 4.5]],
        "circle-opacity": 0.9,
      },
    }, "clusters");

    this.map.on("click", "airports-point", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const geom = f.geometry as GeoJSON.Point;
      new maplibregl.Popup({ closeButton: true, offset: 8 })
        .setLngLat(geom.coordinates as [number, number])
        .setHTML(airportPopup(f.properties as AirportProps))
        .addTo(this.map);
    });
    this.hoverCursor("airports-point");
  }

  setLayerVisible(ids: string[], visible: boolean) {
    for (const id of ids) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    }
  }

  setAlerts(fc: GeoJSON.FeatureCollection) {
    const src = this.map.getSource("alerts") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(fc);
  }

  setAlertVisible(visible: boolean) {
    this.alertVisible = visible;
    this.setLayerVisible(["alert-halo", "alert-core"], visible);
  }

  setBaseLookup(fn: (id: number | null) => string | null) {
    this.baseLookup = fn;
  }

  private baseName(id: number | null): string | null {
    return this.baseLookup(id);
  }

  flyTo(lon: number, lat: number, zoom = 9) {
    this.map.flyTo({ center: [lon, lat], zoom, speed: 1.4, curve: 1.5 });
  }

  private hoverCursor(layer: string) {
    this.map.on("mouseenter", layer, () => (this.map.getCanvas().style.cursor = "pointer"));
    this.map.on("mouseleave", layer, () => (this.map.getCanvas().style.cursor = ""));
  }
}

interface MilProps { name: string; branch: string; component: string; state: string; joint: string | null; }
interface AirportProps { name: string; muni: string | null; iata: string | null; icao: string | null; size: string; }

function basePopup(p: MilProps): string {
  return `
    <div style="padding:12px 14px 14px">
      <div style="font-family:'JetBrains Mono',monospace;color:#D9A646;font-size:10px;letter-spacing:.1em;text-transform:uppercase">${esc(p.branch)}${p.joint ? " · Joint Base" : ""}</div>
      <div style="color:#E8EDF2;font-weight:600;font-size:14px;margin-top:3px">${esc(p.name)}</div>
      <div style="color:#9DB0C4;font-size:11px;margin-top:2px">${esc(p.state)} · ${esc(p.component)}</div>
      <div style="color:#5E7088;font-size:9.5px;margin-top:9px;border-top:1px solid #123059;padding-top:7px">HIFLD USA Military Bases</div>
    </div>`;
}

function airportPopup(p: AirportProps): string {
  const code = p.iata || p.icao || "";
  return `
    <div style="padding:12px 14px 14px">
      <div style="font-family:'JetBrains Mono',monospace;color:#9DB6CE;font-size:11px;letter-spacing:.08em">${esc(code)} · ${p.size === "large" ? "Large hub" : "Regional"}</div>
      <div style="color:#E8EDF2;font-weight:600;font-size:14px;margin-top:3px">${esc(p.name)}</div>
      ${p.muni ? `<div style="color:#9DB0C4;font-size:11px;margin-top:2px">${esc(p.muni)}</div>` : ""}
      <div style="color:#5E7088;font-size:9.5px;margin-top:9px;border-top:1px solid #123059;padding-top:7px">OurAirports (public domain)</div>
    </div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const PRECISION_LABEL: Record<string, string> = {
  city: "City centroid",
  alias: "Metro / airport centroid",
  state: "State centroid (city not resolved)",
};

function popupHtml(s: Sighting, nearestBase: string | null): string {
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

  const proximity = nearestBase != null && s.nd != null
    ? `<div style="display:flex;align-items:center;gap:6px;margin:8px 0 0;color:#E0463F;font-size:11px">
         <span style="width:7px;height:7px;border-radius:50%;background:#E0463F;display:inline-block"></span>
         ${s.nd.toFixed(1)} nm from ${esc(nearestBase)}
       </div>`
    : "";

  return `
    <div style="padding:14px 16px 16px">
      <div style="font-family:'JetBrains Mono',monospace;color:#3DB9D8;font-size:11px;letter-spacing:.08em">${esc(date)}</div>
      <div style="color:#E8EDF2;font-weight:600;font-size:15px;margin-top:2px">${esc(s.c)}, ${esc(s.s)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin:9px 0 0">${chipHtml}</div>
      ${proximity}
      <div style="color:#C5D2E0;font-size:11.5px;line-height:1.5;max-height:150px;overflow:auto;margin-top:9px">${esc(s.n)}</div>
      <div style="color:#5E7088;font-size:9.5px;margin-top:10px;border-top:1px solid #123059;padding-top:7px">
        ${PRECISION_LABEL[s.p] ?? s.p} · FAA UAS Sightings (public records)
      </div>
    </div>`;
}
