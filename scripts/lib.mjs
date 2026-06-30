// Shared helpers for the Skywatch ingest pipeline.

export const STATE_ABBR = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", "DISTRICT OF COLUMBIA": "DC",
  FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL",
  INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA",
  MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN",
  MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
  "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK",
  OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT",
  VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI",
  WYOMING: "WY", "PUERTO RICO": "PR", GUAM: "GU", "VIRGIN ISLANDS": "VI",
};

// Internal-point centroids for the state-level geocoding fallback.
export const STATE_CENTROID = {
  AL: [32.806, -86.791], AK: [61.370, -152.404], AZ: [33.729, -111.431],
  AR: [34.970, -92.373], CA: [36.116, -119.682], CO: [39.060, -105.311],
  CT: [41.598, -72.755], DE: [39.319, -75.507], DC: [38.897, -77.026],
  FL: [27.766, -81.687], GA: [33.040, -83.643], HI: [21.094, -157.498],
  ID: [44.240, -114.478], IL: [40.350, -88.986], IN: [39.849, -86.258],
  IA: [42.011, -93.210], KS: [38.526, -96.726], KY: [37.668, -84.670],
  LA: [31.169, -91.867], ME: [44.693, -69.381], MD: [39.064, -76.741],
  MA: [42.230, -71.530], MI: [43.326, -84.536], MN: [45.694, -93.900],
  MS: [32.741, -89.678], MO: [38.456, -92.288], MT: [46.921, -110.454],
  NE: [41.125, -98.268], NV: [38.313, -117.055], NH: [43.452, -71.564],
  NJ: [40.298, -74.521], NM: [34.840, -106.248], NY: [42.166, -74.948],
  NC: [35.630, -79.806], ND: [47.528, -99.784], OH: [40.388, -82.764],
  OK: [35.565, -96.929], OR: [44.572, -122.071], PA: [40.590, -77.209],
  RI: [41.680, -71.511], SC: [33.856, -80.945], SD: [44.299, -99.438],
  TN: [35.747, -86.692], TX: [31.054, -97.563], UT: [40.150, -111.862],
  VT: [44.045, -72.710], VA: [37.769, -78.170], WA: [47.400, -121.490],
  WV: [38.491, -80.954], WI: [44.268, -89.616], WY: [42.756, -107.302],
  PR: [18.220, -66.590], GU: [13.444, 144.794], VI: [18.336, -64.896],
};

const LSAD_STRIP =
  /\s+(city|town|village|borough|municipality|CDP|comunidad|zona urbana|consolidated government|metro government|metropolitan government|unified government|government|corporation|plantation|grant|gore|township|charter township|urban county|balance)$/i;

// Normalize a place name for matching: uppercase, collapse whitespace, fold
// common abbreviations, drop punctuation. Applied to both FAA and gazetteer names.
export function normCity(s) {
  let t = String(s).toUpperCase().trim().replace(/\s+/g, " ");
  t = t.replace(/\bSAINT /g, "ST ").replace(/\bST\. /g, "ST ");
  t = t.replace(/\bFT\. /g, "FT ").replace(/\bFORT /g, "FT ");
  return t.replace(/[.']/g, "");
}

export function normGazName(name) {
  return normCity(name.replace(LSAD_STRIP, ""));
}

// FAA narratives are terse FAA-OPS dispatch lines. Pull out the few fields that
// are consistently present. Anything not clearly stated stays null — we never guess.
export function parseNarrative(summary) {
  const s = String(summary || "").toUpperCase();

  // Altitude: "...AT 1,100 FEET..." (take the first explicit altitude).
  let altitudeFt = null;
  const alt = s.match(/AT\s+([\d,]{2,7})\s*(?:FEET|FT)\b/);
  if (alt) {
    const n = Number(alt[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 0 && n <= 60000) altitudeFt = n;
  }

  // Evasive action: explicit "NO EVASIVE ACTION" vs "EVASIVE ACTION TAKEN/REPORTED".
  let evasive = null;
  if (/NO\s+EVASIVE\s+ACTION/.test(s)) evasive = false;
  else if (/EVASIVE\s+ACTION\s+(TAKEN|REPORTED|REQUIRED|NECESSARY)/.test(s)) evasive = true;

  // Incident class as the FAA logs it.
  let incidentType = null;
  if (/UAS\s+INCIDENT/.test(s)) incidentType = "INCIDENT";
  else if (/UAS\s+SIGHTING/.test(s)) incidentType = "SIGHTING";

  // Coarse UAS descriptor when explicitly named.
  let uasKind = null;
  if (/QUAD\s?COPTER|QUADCOPTER/.test(s)) uasKind = "QUADCOPTER";
  else if (/FIXED\s?WING/.test(s)) uasKind = "FIXED WING";
  else if (/HELICOPTER|HELO/.test(s)) uasKind = "HELICOPTER";
  else if (/BALLOON/.test(s)) uasKind = "BALLOON";

  return { altitudeFt, evasive, incidentType, uasKind };
}

// Parse a cell that may be a JS Date, an Excel serial number, or a "M/D/YYYY"
// string into an ISO yyyy-mm-dd. Returns null if unparseable.
export function parseDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    // Excel serial date (1900 date system).
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const m = String(v).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = "20" + yr;
    const iso = `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
    const d = new Date(iso + "T00:00:00Z");
    return isNaN(d.getTime()) ? null : iso;
  }
  return null;
}
