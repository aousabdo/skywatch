// Refresh the raw FAA UAS Sightings XLSX files into data/raw/faa.
// Scrapes the public-records index page for every .xlsx link and downloads it.
//
//   node scripts/fetch-faa.mjs
//
// Then re-run `npm run ingest` to rebuild public/data/sightings.json.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "data/raw/faa");
const INDEX = "https://www.faa.gov/uas/resources/public_records/uas_sightings_report";
const ORIGIN = "https://www.faa.gov";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

mkdirSync(OUT_DIR, { recursive: true });

const page = await fetch(INDEX, { headers: { "User-Agent": UA } });
if (!page.ok) throw new Error(`index page ${page.status}`);
const html = await page.text();

const links = [...new Set([...html.matchAll(/href="([^"]+\.xlsx)"/gi)].map((m) => m[1]))];
if (!links.length) throw new Error("no .xlsx links found — page layout may have changed");

console.log(`Found ${links.length} files`);
for (const href of links) {
  const url = href.startsWith("http") ? href : ORIGIN + href;
  const name = basename(href);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    console.warn(`  skip ${name} (${res.status})`);
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(OUT_DIR, name), buf);
  console.log(`  ${name}  ${(buf.length / 1024).toFixed(0)} KB`);
}
console.log(`\nWrote to ${OUT_DIR}. Run \`npm run ingest\` next.`);
