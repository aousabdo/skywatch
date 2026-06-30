import "./style.css";
import { SkyMap } from "./map";
import { Timeline } from "./timeline";
import { loadDataset, loadGeoJSON, toFeatures, filterFeatures, dayToDate } from "./data";
import type { Sighting, SightingFeature } from "./types";

const BASE = import.meta.env.BASE_URL;

// US state names for the filter dropdown labels.
const STATE_NAME: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  PR: "Puerto Rico", GU: "Guam", VI: "Virgin Islands",
};

const $ = <T extends Element>(sel: string): T => document.querySelector(sel) as T;

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

async function main() {
  const data = await loadDataset(BASE);
  const sightings = data.sightings;
  const byId = new Map<number, Sighting>(sightings.map((s) => [s.id, s]));
  const features = toFeatures(sightings);

  const map = new SkyMap("map");
  map.setSightingLookup((id) => byId.get(id));

  // State filter options, ordered by sighting volume.
  const stateSel = $<HTMLSelectElement>("#state-filter");
  for (const [abbr] of Object.entries(data.meta.byState).sort((a, b) => b[1] - a[1])) {
    const opt = document.createElement("option");
    opt.value = abbr;
    opt.textContent = `${STATE_NAME[abbr] ?? abbr} (${data.meta.byState[abbr]})`;
    stateSel.appendChild(opt);
  }

  let state = "";
  let range: [number, number] = [0, 0];

  const apply = () => {
    const filtered = filterFeatures(features, range[0], range[1], state);
    map.setData({ type: "FeatureCollection", features: filtered });
    updatePanel(filtered, range);
  };

  const timeline = new Timeline({
    container: $("#timeline"),
    byMonth: data.meta.byMonth,
    dateMin: data.meta.dateMin,
    dateMax: data.meta.dateMax,
    onChange: (min, max) => {
      range = [min, max];
      apply();
    },
  });
  range = timeline.current;

  stateSel.addEventListener("change", () => {
    state = stateSel.value;
    apply();
  });

  apply();
  ($("#loading") as HTMLElement).style.display = "none";

  // Critical-infrastructure overlays — loaded lazily after first paint so the
  // sightings map is interactive immediately.
  wireLayerToggles(map);
  map.ready.then(async () => {
    const [military, airports] = await Promise.all([
      loadGeoJSON(BASE, "data/overlays/military.json"),
      loadGeoJSON(BASE, "data/overlays/airports.json"),
    ]);
    map.addMilitary(military);
    map.addAirports(airports);
  });
}

const LAYER_IDS: Record<string, string[]> = {
  sightings: ["clusters", "cluster-count", "point"],
  military: ["military-fill", "military-line"],
  airports: ["airports-point"],
};

function wireLayerToggles(map: SkyMap) {
  document.querySelectorAll<HTMLInputElement>("input[data-layer]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const ids = LAYER_IDS[cb.dataset.layer!];
      if (ids) map.setLayerVisible(ids, cb.checked);
    });
  });
}

function updatePanel(filtered: SightingFeature[], range: [number, number]) {
  $("[data-count]").textContent = filtered.length.toLocaleString();
  $("#window-label").textContent = `${fmtDate(dayToDate(range[0]))} — ${fmtDate(dayToDate(range[1]))}`;

  const counts = new Map<string, number>();
  for (const f of filtered) {
    const s = f.properties.s;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = top[0]?.[1] ?? 1;
  const ul = $("#top-states");
  ul.innerHTML = top
    .map(([abbr, n]) => {
      const w = Math.round((100 * n) / max);
      return `<li class="flex items-center gap-2">
        <span class="text-fog-dim w-7">${abbr}</span>
        <span class="flex-1 h-1.5 rounded-sm bg-navy-700 overflow-hidden">
          <span class="block h-full bg-cyan" style="width:${w}%"></span>
        </span>
        <span class="text-fog tnum w-9 text-right">${n}</span>
      </li>`;
    })
    .join("");
}

main().catch((err) => {
  console.error(err);
  const loading = $("#loading") as HTMLElement;
  loading.innerHTML = `<div class="text-danger-bright font-mono text-sm">Failed to load: ${String(err)}</div>`;
});
