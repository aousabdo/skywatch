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

console.log("\nRun `npm run build-overlays` next.");
