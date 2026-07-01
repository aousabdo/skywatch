import "./style.css";
import { SkyMap } from "./map";
import { Timeline } from "./timeline";
import { loadDataset, loadGeoJSON, toFeatures, filterFeatures, dayToDate, epochDay } from "./data";
import type { Base, Sighting, SightingFeature } from "./types";

const BASE = import.meta.env.BASE_URL;

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

const BRANCH_ABBR: Record<string, string> = {
  "Air Force": "USAF", Army: "ARMY", Navy: "NAVY", "Marine Corps": "USMC",
  "Coast Guard": "USCG", Other: "DOD",
};

const $ = <T extends Element>(sel: string): T => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const fmtWindow = (a: number, b: number) => `${fmtDate(dayToDate(a))} — ${fmtDate(dayToDate(b))}`;
const isoOfDay = (day: number) => dayToDate(day).toISOString().slice(0, 10);

// --- Shareable view state, encoded in the URL hash -----------------------
interface ViewState {
  w?: [string, string]; // window ISO dates
  r: number;            // proximity radius nm
  s: string;            // state filter
  q: string;            // narrative search
  l: Record<string, boolean>; // layer visibility
}

const DEFAULT_LAYERS = { sightings: true, alerts: true, military: false, airports: false, intl: false };

function readHash(): ViewState {
  const p = new URLSearchParams(location.hash.slice(1));
  const w = p.get("w");
  const layers = { ...DEFAULT_LAYERS };
  const l = p.get("l");
  if (l !== null) for (const k of Object.keys(layers)) layers[k as keyof typeof layers] = l.split(",").includes(k);
  const wm = w?.match(/^(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})$/);
  return {
    w: wm ? [wm[1]!, wm[2]!] : undefined,
    r: [5, 10, 25].includes(Number(p.get("r"))) ? Number(p.get("r")) : 10,
    s: p.get("s") ?? "",
    q: p.get("q") ?? "",
    l: layers,
  };
}

function writeHash(v: ViewState) {
  const p = new URLSearchParams();
  if (v.w) p.set("w", `${v.w[0]},${v.w[1]}`);
  p.set("r", String(v.r));
  if (v.s) p.set("s", v.s);
  if (v.q) p.set("q", v.q);
  const on = Object.entries(v.l).filter(([, vis]) => vis).map(([k]) => k);
  p.set("l", on.join(","));
  history.replaceState(null, "", `#${p.toString()}`);
}

async function main() {
  const [data, basesArr, intlFc] = await Promise.all([
    loadDataset(BASE),
    fetch(`${BASE}data/overlays/bases.json`).then((r) => r.json() as Promise<Base[]>),
    loadGeoJSON(BASE, "data/intl/incidents.json"),
  ]);
  const sightings = data.sightings;
  const byId = new Map<number, Sighting>(sightings.map((s) => [s.id, s]));
  const baseById = new Map<number, Base>(basesArr.map((b) => [b.id, b]));
  const features = toFeatures(sightings);

  // Curated international incidents, tagged with an epoch day so they share the
  // time window with the FAA sightings (and the time-lapse).
  const intlByDay = intlFc.features.map((f) => ({
    f,
    day: epochDay((f.properties as { date: string }).date),
  }));

  // Extend the scrubbable domain back to the earliest international incident so
  // pre-2019 events (Gatwick, Caracas, Mosul) are reachable and join the sweep.
  const domainMin = [data.meta.dateMin, ...intlByDay.map((x) => (x.f.properties as { date: string }).date)]
    .sort()[0]!;

  const map = new SkyMap("map");
  map.setSightingLookup((id) => byId.get(id));
  map.setBaseLookup((id) => (id == null ? null : baseById.get(id)?.name ?? null));

  const view = readHash();

  const stateSel = $<HTMLSelectElement>("#state-filter");
  for (const [abbr] of Object.entries(data.meta.byState).sort((a, b) => b[1] - a[1])) {
    const opt = document.createElement("option");
    opt.value = abbr;
    opt.textContent = `${STATE_NAME[abbr] ?? abbr} (${data.meta.byState[abbr]})`;
    stateSel.appendChild(opt);
  }

  let state = view.s;
  let range: [number, number] = [0, 0];
  let radius = view.r;
  let search = view.q;
  let topBaseId: number | null = null;
  let playing = false;
  const faaMinDay = epochDay(data.meta.dateMin);

  const radiusSel = $<HTMLSelectElement>("#radius");
  radiusSel.value = String(radius);
  stateSel.value = state;
  const searchInput = $<HTMLInputElement>("#search");
  searchInput.value = search;
  for (const cb of document.querySelectorAll<HTMLInputElement>("input[data-layer]")) {
    cb.checked = view.l[cb.dataset.layer!] ?? cb.checked;
  }

  // National year-over-year trend (last 12 months vs the prior 12), computed once.
  renderYoY(data.meta.byMonth);

  const sync = () => writeHash({ w: [isoOfDay(range[0]), isoOfDay(range[1])], r: radius, s: state, q: search, l: view.l });

  const matchesSearch = (f: SightingFeature, q: string) => {
    const s = byId.get(f.properties.id);
    return !!s && (s.n.toLowerCase().includes(q) || s.c.toLowerCase().includes(q));
  };

  const apply = () => {
    const inWindow = filterFeatures(features, range[0], range[1], state);
    const q = search.trim().toLowerCase();
    const filtered = q ? inWindow.filter((f) => matchesSearch(f, q)) : inWindow;
    map.setData({ type: "FeatureCollection", features: filtered });

    $("#search-info").textContent = q ? `${filtered.length.toLocaleString()} of ${inWindow.length.toLocaleString()} match "${search.trim()}"` : "";

    // Proximity alerts: filtered sightings within `radius` nm of a base.
    const alerts: SightingFeature[] = [];
    const counts = new Map<number, number>();
    for (const f of filtered) {
      const { nd, nb } = f.properties;
      if (nd == null || nb == null || nd > radius) continue;
      alerts.push(f);
      counts.set(nb, (counts.get(nb) ?? 0) + 1);
    }
    map.setAlerts({ type: "FeatureCollection", features: alerts });

    // Prior-period base counts (same length window immediately before) to flag rising hotspots.
    const width = range[1] - range[0];
    const priorCounts = new Map<number, number>();
    for (const f of features) {
      const p = f.properties;
      if (p.d >= range[0] || p.d < range[0] - width) continue;
      if (state && p.s !== state) continue;
      if (p.nd == null || p.nb == null || p.nd > radius) continue;
      if (q && !matchesSearch(f, q)) continue;
      priorCounts.set(p.nb, (priorCounts.get(p.nb) ?? 0) + 1);
    }

    // Only flag "rising" when a real prior period exists within the FAA data.
    const showRising = range[0] > faaMinDay;

    // International incidents within the same window.
    const intl = intlByDay.filter((x) => x.day >= range[0] && x.day <= range[1]).map((x) => x.f);
    map.setIntl({ type: "FeatureCollection", features: intl });

    topBaseId = updatePanel(filtered.length, alerts.length, counts, priorCounts, showRising, baseById, range, radius, map);
    if (!playing) sync();
  };

  const timeline = new Timeline({
    container: $("#timeline"),
    byMonth: data.meta.byMonth,
    dateMin: domainMin,
    dateMax: data.meta.dateMax,
    initial: view.w,
    onChange: (min, max) => {
      range = [min, max];
      apply();
    },
  });
  range = timeline.current;

  stateSel.addEventListener("change", () => { state = stateSel.value; apply(); });
  radiusSel.addEventListener("change", (e) => {
    radius = Number((e.target as HTMLSelectElement).value);
    apply();
  });
  let searchTimer: ReturnType<typeof setTimeout>;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { search = searchInput.value; apply(); }, 160);
  });

  // Quick-nav controls.
  $("#jump-top").addEventListener("click", () => {
    if (topBaseId == null) return;
    const b = baseById.get(topBaseId);
    if (b) map.flyTo(b.lon, b.lat, 9);
  });
  $("#reset-view").addEventListener("click", () => map.resetView());

  // International layer: its curated incidents span 2017–2024, so enabling it
  // widens the window to the full history and pulls the camera out to a world view.
  const intlCb = $<HTMLInputElement>('input[data-layer="intl"]');
  intlCb.addEventListener("change", () => {
    view.l.intl = intlCb.checked;
    map.setLayerVisible(LAYER_IDS.intl!, intlCb.checked);
    if (intlCb.checked) {
      stopPlay();
      const [minDay, maxDay] = timeline.domainDays;
      timeline.setWindowDays(minDay, maxDay); // triggers apply(); sync() runs there
      map.flyToWorld();
    } else {
      sync();
    }
  });

  // Time-lapse player: sweep a fixed-width window across the full history.
  // setInterval (not rAF) so playback also advances when the tab is backgrounded;
  // progress is driven by elapsed wall-clock time, so it always finishes in ~15s.
  let playTimer: ReturnType<typeof setInterval> | null = null;
  const setPlayUI = (on: boolean) => {
    $("#play-icon").textContent = on ? "❙❙" : "▶";
    $("#play-label").textContent = on ? "Pause" : "Play the timeline";
  };
  const stopPlay = () => {
    if (!playing) return;
    playing = false;
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    setPlayUI(false);
    sync();
  };
  const startPlay = () => {
    const [minDay, maxDay] = timeline.domainDays;
    const span = maxDay - minDay;
    const w = Math.min(range[1] - range[0], Math.max(30, Math.floor(span / 8)));
    const startPos = minDay;
    const endPos = Math.max(minDay, maxDay - w);
    const durationMs = 15000;
    const t0 = performance.now();
    playing = true;
    setPlayUI(true);
    playTimer = setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / durationMs);
      const pos = Math.round(startPos + p * (endPos - startPos));
      timeline.setWindowDays(pos, pos + w); // drives apply() via onChange
      if (p >= 1) stopPlay();
    }, 60);
  };
  $("#play").addEventListener("click", () => (playing ? stopPlay() : startPlay()));
  // Manual interaction cancels playback.
  ($("#timeline") as HTMLElement).addEventListener("pointerdown", stopPlay);
  $("#copy-link").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      const btn = $("#copy-link");
      const prev = btn.textContent;
      btn.textContent = "✓ Copied";
      setTimeout(() => (btn.textContent = prev), 1400);
    } catch { /* clipboard unavailable */ }
  });

  // Data-freshness stamp.
  const through = new Date(data.meta.dateMax + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "short", timeZone: "UTC" });
  $("#data-through").textContent = ` · data through ${through}`;

  // Mobile panel toggles (mutually exclusive overlays).
  document.querySelectorAll<HTMLButtonElement>("#mobile-toggles button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.toggle!)!;
      const wasOpen = target.classList.contains("open");
      $("#panel").classList.remove("open");
      $("#layers-panel").classList.remove("open");
      if (!wasOpen) target.classList.add("open");
    });
  });
  map.map.on("click", () => {
    $("#panel").classList.remove("open");
    $("#layers-panel").classList.remove("open");
  });

  apply();
  ($("#loading") as HTMLElement).style.display = "none";

  // Overlays, loaded after first paint; visibility restored from the URL.
  wireLayerToggles(map, view.l, sync);
  map.ready.then(async () => {
    // Re-run now that the sightings + alert sources exist, so both populate on
    // first load regardless of when the style finished loading.
    apply();
    map.setAlertVisible(view.l.alerts ?? true);
    map.setLayerVisible(LAYER_IDS.sightings!, view.l.sightings ?? true);
    const [military, airports] = await Promise.all([
      loadGeoJSON(BASE, "data/overlays/military.json"),
      loadGeoJSON(BASE, "data/overlays/airports.json"),
    ]);
    map.addMilitary(military);
    map.addAirports(airports);
    map.addInternational(intlFc);
    map.setLayerVisible(LAYER_IDS.military!, view.l.military ?? false);
    map.setLayerVisible(LAYER_IDS.airports!, view.l.airports ?? false);
    map.setLayerVisible(LAYER_IDS.intl!, view.l.intl ?? false);
    if (view.l.intl) map.flyToWorld();
  });

  // Modals (About + Methodology).
  const setModal = (id: string, on: boolean) => {
    const m = $(`#${id}`) as HTMLElement;
    m.classList.toggle("hidden", !on);
    m.classList.toggle("flex", on);
  };
  $("#open-methodology").addEventListener("click", () => setModal("methodology", true));
  $("#close-methodology").addEventListener("click", () => setModal("methodology", false));
  $("#methodology").addEventListener("click", (e) => { if (e.target === e.currentTarget) setModal("methodology", false); });
  $("#open-about").addEventListener("click", () => setModal("about", true));
  $("#close-about").addEventListener("click", () => setModal("about", false));
  $("#about").addEventListener("click", (e) => { if (e.target === e.currentTarget) setModal("about", false); });
  $("#about-methodology").addEventListener("click", () => { setModal("about", false); setModal("methodology", true); });

  // Export a branded PNG of the current view.
  $("#export-brief").addEventListener("click", () => exportBrief(map, through));
}

function exportBrief(map: SkyMap, dataThrough: string) {
  const src = map.getMapCanvas();
  const dpr = src.clientWidth ? src.width / src.clientWidth : 1;
  const headerH = Math.round(118 * dpr);
  const footerH = Math.round(44 * dpr);
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height + headerH + footerH;
  const ctx = out.getContext("2d")!;
  const pad = 30 * dpr;

  ctx.fillStyle = "#0B1F3A";
  ctx.fillRect(0, 0, out.width, out.height);

  ctx.fillStyle = "#E8EDF2";
  ctx.font = `700 ${33 * dpr}px Inter, Arial, sans-serif`;
  ctx.fillText("SKYWATCH", pad, 48 * dpr);
  const titleW = ctx.measureText("SKYWATCH").width;
  ctx.fillStyle = "#9DB0C4";
  ctx.font = `${14 * dpr}px Inter, Arial, sans-serif`;
  ctx.fillText("COUNTER-UAS INCIDENT ATLAS", pad + titleW + 16 * dpr, 48 * dpr);

  const windowLabel = $("#window-label").textContent ?? "";
  const count = $("[data-count]").textContent ?? "";
  const caption = ($("#alert-caption").textContent ?? "").trim();
  ctx.fillStyle = "#3DB9D8";
  ctx.font = `${16 * dpr}px "JetBrains Mono", monospace`;
  ctx.fillText(windowLabel, pad, 82 * dpr);
  ctx.fillStyle = "#C5D2E0";
  ctx.font = `${15 * dpr}px Inter, Arial, sans-serif`;
  ctx.fillText(`${count} sightings in view${caption ? "  ·  " + caption : ""}`, pad, 104 * dpr);

  const finish = () => {
    try {
      out.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `skywatch-${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, "image/png");
    } catch { /* tainted canvas — map tiles without CORS */ }
  };

  // Footer band.
  const footY = headerH + src.height;
  const drawFooter = () => {
    ctx.fillStyle = "#0D2545";
    ctx.fillRect(0, footY, out.width, footerH);
    ctx.fillStyle = "#3DB9D8";
    ctx.font = `${13 * dpr}px "JetBrains Mono", monospace`;
    ctx.fillText("[~] Built by OCEANS LLC", pad, footY + 28 * dpr);
    ctx.fillStyle = "#5E7088";
    ctx.font = `${12 * dpr}px Inter, Arial, sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(`City/metro centroids · FAA UAS Sightings · data through ${dataThrough}`, out.width - pad, footY + 28 * dpr);
    ctx.textAlign = "left";
  };

  try {
    ctx.drawImage(src, 0, headerH);
  } catch { /* ignore */ }
  drawFooter();
  finish();
}

function renderYoY(byMonth: Record<string, number>) {
  const months = Object.keys(byMonth).sort();
  const el = $("#yoy");
  if (months.length < 24) { el.textContent = ""; return; }
  const sum = (ms: string[]) => ms.reduce((s, m) => s + (byMonth[m] ?? 0), 0);
  const last12 = sum(months.slice(-12));
  const prev12 = sum(months.slice(-24, -12));
  if (!prev12) { el.textContent = ""; return; }
  const pct = Math.round(((last12 - prev12) / prev12) * 100);
  const up = pct >= 0;
  const color = up ? "#E0463F" : "#5FD2EE";
  el.innerHTML = `National trend <span style="color:${color};font-weight:600">${up ? "▲" : "▼"} ${Math.abs(pct)}%</span> <span class="text-fog-dim">YoY · ${last12.toLocaleString()} in last 12 mo</span>`;
}

function updatePanel(
  inView: number,
  alertCount: number,
  counts: Map<number, number>,
  priorCounts: Map<number, number>,
  showRising: boolean,
  baseById: Map<number, Base>,
  range: [number, number],
  radius: number,
  map: SkyMap,
): number | null {
  $("[data-count]").textContent = inView.toLocaleString();
  $("#window-label").textContent = fmtWindow(range[0], range[1]);
  $("#alert-count").textContent = alertCount.toLocaleString();

  const ranked = [...counts.entries()]
    .map(([id, n]) => ({ base: baseById.get(id)!, n }))
    .filter((r) => r.base)
    .sort((a, b) => b.n - a.n);

  // Auto caption from the #1 installation — the wow line.
  const caption = $("#alert-caption");
  if (ranked.length) {
    const top = ranked[0]!;
    caption.innerHTML = `<span class="text-fog">${top.n}</span> within ${radius} nm of <span class="text-fog">${esc(top.base.name)}</span> this window`;
  } else {
    caption.textContent = "No sightings near an installation in this window.";
  }

  const max = ranked[0]?.n ?? 1;
  const ol = $("#hotspots");
  ol.innerHTML = ranked.slice(0, 25)
    .map((r, i) => {
      const w = Math.round((100 * r.n) / max);
      // "Rising" = a genuine acceleration vs the prior equal-length period,
      // not merely any increase (the whole dataset trends up).
      const prior = priorCounts.get(r.base.id) ?? 0;
      const rising = showRising && r.n >= 3 && r.n >= prior * 1.5 + 2;
      const riseTag = rising
        ? `<span class="text-[9px] font-semibold" style="color:#E0463F" title="up from ${prior} in the prior ${range[1] - range[0]}-day period">▲ rising</span>`
        : "";
      return `<li class="flex items-center gap-2 cursor-pointer hover:bg-navy-700/60 rounded px-1 py-0.5" data-base="${r.base.id}">
        <span class="text-fog-dim w-4 text-right tnum">${i + 1}</span>
        <span class="flex-1 min-w-0">
          <span class="text-fog block truncate">${esc(r.base.name)}</span>
          <span class="flex items-center gap-1.5 mt-0.5">
            <span class="text-[9px] text-fog-dim tracking-wide">${BRANCH_ABBR[r.base.branch] ?? "DOD"} · ${esc(r.base.state)}</span>
            ${riseTag}
          </span>
        </span>
        <span class="w-10 h-1 rounded-sm bg-navy-700 overflow-hidden shrink-0">
          <span class="block h-full" style="width:${w}%;background:#E0463F"></span>
        </span>
        <span class="text-danger-bright tnum w-6 text-right">${r.n}</span>
      </li>`;
    })
    .join("");

  ol.querySelectorAll<HTMLElement>("li[data-base]").forEach((li) => {
    li.addEventListener("click", () => {
      const b = baseById.get(Number(li.dataset.base));
      if (b) map.flyTo(b.lon, b.lat, 9);
    });
  });

  return ranked[0]?.base.id ?? null;
}

const LAYER_IDS: Record<string, string[]> = {
  sightings: ["clusters", "cluster-count", "point"],
  military: ["military-fill", "military-line"],
  airports: ["airports-point"],
  intl: ["intl-halo", "intl-core"],
};

function wireLayerToggles(map: SkyMap, layers: Record<string, boolean>, sync: () => void) {
  document.querySelectorAll<HTMLInputElement>("input[data-layer]").forEach((cb) => {
    if (cb.dataset.layer === "intl") return; // handled separately (needs the timeline)
    cb.addEventListener("change", () => {
      const key = cb.dataset.layer!;
      layers[key] = cb.checked;
      if (key === "alerts") map.setAlertVisible(cb.checked);
      else { const ids = LAYER_IDS[key]; if (ids) map.setLayerVisible(ids, cb.checked); }
      sync();
    });
  });
}

main().catch((err) => {
  console.error(err);
  const loading = $("#loading") as HTMLElement;
  loading.innerHTML = `<div class="text-danger-bright font-mono text-sm">Failed to load: ${String(err)}</div>`;
});
