// (Re)download the raw critical-infrastructure overlay sources into
// data/raw/overlays. Then run `npm run build-overlays`.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW = join(__dirname, "..", "data/raw/overlays");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

mkdirSync(RAW, { recursive: true });

async function get(url, name) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(RAW, name), buf);
  console.log(`  ${name}  ${(buf.length / 1024).toFixed(0)} KB`);
}

// OurAirports — public domain global airport database.
await get("https://davidmegginson.github.io/ourairports-data/airports.csv", "airports.csv");

// HIFLD "USA Military Bases" (generalized polygons via ArcGIS query API).
const MIL =
  "https://services.arcgis.com/hRUr1F8lE8Jq2uJo/arcgis/rest/services/milbases/FeatureServer/0/query" +
  "?where=1%3D1&outFields=SITE_NAME,COMPONENT,STATE_TERR,JOINT_BASE" +
  "&returnGeometry=true&maxAllowableOffset=0.004&geometryPrecision=5&outSR=4326&f=geojson&resultRecordCount=1000";
await get(MIL, "milbases.geojson");

// FAA National Security UAS Flight Restrictions — federal no-drone zones
// (paginated; ~2,257 generalized polygons).
const NSUFR_FS =
  "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/DoD_Mar_13/FeatureServer/0/query";
const nsufr = { type: "FeatureCollection", features: [] };
for (let offset = 0; offset < 4000; offset += 1000) {
  const url =
    `${NSUFR_FS}?where=1%3D1&outFields=Base,Branch,Airspace,State,Reason,Floor,Ceiling` +
    `&returnGeometry=true&maxAllowableOffset=0.005&geometryPrecision=4&outSR=4326&f=geojson` +
    `&resultOffset=${offset}&resultRecordCount=1000`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) break;
  const page = await res.json();
  const feats = page.features ?? [];
  nsufr.features.push(...feats);
  if (feats.length < 1000) break;
}
writeFileSync(join(RAW, "nsufr.geojson"), JSON.stringify(nsufr));
console.log(`  nsufr.geojson  ${(Buffer.byteLength(JSON.stringify(nsufr)) / 1024).toFixed(0)} KB (${nsufr.features.length} zones)`);

console.log("\nRun `npm run build-overlays` next.");
