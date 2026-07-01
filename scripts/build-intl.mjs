// Curated set of notable, publicly documented international drone incidents,
// emitted as GeoJSON for the "International incidents" layer.
//
//   -> public/data/intl/incidents.json
//
// This is deliberately a CURATED, ILLUSTRATIVE set of well-known events — not a
// comprehensive database. Each entry is a real, widely reported incident; every
// one carries a source attribution. Locations are facility/city centroids. It
// exists to give the CONUS FAA picture an overseas frame of reference, and is
// labelled as curated in the UI so it is never mistaken for the FAA dataset.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public/data/intl");
mkdirSync(OUT, { recursive: true });

// category: airport | infrastructure | military | maritime | vip
const INCIDENTS = [
  { date: "2018-08-04", place: "Caracas", country: "Venezuela", lat: 10.500, lon: -66.917, category: "vip", summary: "Explosive-laden drones detonated near President Maduro during a military parade.", source: "BBC News" },
  { date: "2018-12-19", place: "Gatwick Airport", country: "United Kingdom", lat: 51.148, lon: -0.190, category: "airport", summary: "Repeated drone sightings shut Gatwick for ~33 hours, disrupting ~1,000 flights and 140,000 passengers.", source: "BBC News" },
  { date: "2019-01-08", place: "Heathrow Airport", country: "United Kingdom", lat: 51.470, lon: -0.454, category: "airport", summary: "A drone sighting halted departures at Heathrow for about an hour.", source: "The Guardian" },
  { date: "2019-06-20", place: "Strait of Hormuz", country: "Iran", lat: 26.600, lon: 56.900, category: "military", summary: "Iran shot down a US Navy RQ-4 Global Hawk surveillance drone.", source: "Reuters" },
  { date: "2019-09-14", place: "Abqaiq / Khurais", country: "Saudi Arabia", lat: 25.930, lon: 49.670, category: "infrastructure", summary: "Drone and missile strikes on Aramco processing facilities cut roughly 5% of global oil supply.", source: "Reuters" },
  { date: "2020-09-27", place: "Nagorno-Karabakh", country: "Azerbaijan/Armenia", lat: 39.820, lon: 46.750, category: "military", summary: "Loitering munitions and TB2 drones proved decisive in the Second Nagorno-Karabakh War.", source: "Reuters" },
  { date: "2021-07-29", place: "Gulf of Oman", country: "Oman", lat: 24.500, lon: 58.500, category: "maritime", summary: "A drone attack on the tanker Mercer Street killed two crew members.", source: "Associated Press" },
  { date: "2022-01-17", place: "Abu Dhabi", country: "United Arab Emirates", lat: 24.433, lon: 54.650, category: "infrastructure", summary: "Houthi drone attack near ADNOC fuel facilities and the airport killed three people.", source: "Reuters" },
  { date: "2022-10-17", place: "Kyiv", country: "Ukraine", lat: 50.450, lon: 30.523, category: "infrastructure", summary: "Waves of Shahed-136 loitering munitions struck the capital and the power grid.", source: "Reuters" },
  { date: "2023-05-03", place: "Moscow Kremlin", country: "Russia", lat: 55.752, lon: 37.617, category: "vip", summary: "Two drones were downed over the Kremlin; Russia called it an assassination attempt on the president.", source: "Reuters" },
  { date: "2023-08-01", place: "Moscow City", country: "Russia", lat: 55.750, lon: 37.534, category: "infrastructure", summary: "Repeated drone strikes hit the Moscow-City business district over the summer.", source: "BBC News" },
  { date: "2023-08-30", place: "Pskov", country: "Russia", lat: 57.783, lon: 28.335, category: "military", summary: "A drone raid on Pskov airfield damaged multiple Il-76 military transport aircraft.", source: "Reuters" },
  { date: "2024-01-28", place: "Tower 22", country: "Jordan", lat: 32.280, lon: 38.990, category: "military", summary: "A one-way attack drone struck the US Tower 22 outpost, killing three American soldiers.", source: "US DoD / AP" },
  { date: "2024-01-15", place: "Bab-el-Mandeb / Red Sea", country: "Yemen", lat: 15.000, lon: 42.000, category: "maritime", summary: "Houthi drones and missiles repeatedly targeted commercial shipping in the Red Sea.", source: "Reuters" },
  { date: "2018-01-06", place: "Khmeimim Air Base", country: "Syria", lat: 35.401, lon: 35.948, category: "military", summary: "A swarm of improvised drones attacked Russia's Khmeimim air base.", source: "Reuters" },
  { date: "2017-03-01", place: "Mosul", country: "Iraq", lat: 36.340, lon: 43.130, category: "military", summary: "ISIS used weaponized commercial quadcopters to drop munitions on Iraqi forces.", source: "Reuters" },
  { date: "2021-03-19", place: "Ras Tanura", country: "Saudi Arabia", lat: 26.640, lon: 50.160, category: "infrastructure", summary: "A drone attack targeted the Ras Tanura oil port, one of the world's largest.", source: "Reuters" },
  { date: "2023-07-17", place: "Kerch Bridge", country: "Crimea", lat: 45.300, lon: 36.500, category: "maritime", summary: "Naval surface drones struck the Kerch Strait bridge, damaging the roadway.", source: "BBC News" },
  { date: "2022-04-25", place: "Belgorod", country: "Russia", lat: 50.596, lon: 36.588, category: "infrastructure", summary: "Cross-border drone strikes hit fuel depots and infrastructure in Belgorod.", source: "Reuters" },
  { date: "2024-08-06", place: "Kursk", country: "Russia", lat: 51.730, lon: 36.193, category: "military", summary: "Drones featured heavily in the cross-border incursion into Kursk oblast.", source: "Reuters" },
  { date: "2019-08-17", place: "Shaybah", country: "Saudi Arabia", lat: 22.514, lon: 53.966, category: "infrastructure", summary: "Houthi drones struck the Shaybah oilfield and its gas facilities.", source: "Reuters" },
  { date: "2023-05-30", place: "Moscow (residential)", country: "Russia", lat: 55.640, lon: 37.470, category: "infrastructure", summary: "Multiple drones struck residential districts of Moscow in a rare deep-strike raid.", source: "Reuters" },
  { date: "2022-03-24", place: "Zaporizhzhia", country: "Ukraine", lat: 47.838, lon: 35.139, category: "military", summary: "Reconnaissance and strike drones were used intensively around the front lines.", source: "Reuters" },
  { date: "2021-11-07", place: "Baghdad Green Zone", country: "Iraq", lat: 33.303, lon: 44.380, category: "vip", summary: "Armed drones targeted the residence of the Iraqi prime minister.", source: "Associated Press" },
  { date: "2024-02-02", place: "Dnipro", country: "Ukraine", lat: 48.465, lon: 35.046, category: "infrastructure", summary: "Long-range drones and missiles repeatedly struck energy infrastructure.", source: "Reuters" },
  { date: "2020-01-03", place: "Baghdad Airport", country: "Iraq", lat: 33.262, lon: 44.234, category: "military", summary: "A US MQ-9 Reaper drone strike killed IRGC commander Qassem Soleimani.", source: "Reuters" },
  { date: "2023-12-23", place: "Southern Red Sea", country: "Yemen", lat: 13.600, lon: 42.900, category: "maritime", summary: "One-way attack drones targeted tankers and container ships transiting the strait.", source: "US CENTCOM / Reuters" },
  { date: "2022-09-23", place: "Odesa", country: "Ukraine", lat: 46.482, lon: 30.723, category: "infrastructure", summary: "Shahed-136 drones struck port and grid infrastructure at Odesa.", source: "Reuters" },
  { date: "2019-05-14", place: "Afif (East-West pipeline)", country: "Saudi Arabia", lat: 23.906, lon: 42.917, category: "infrastructure", summary: "Houthi drones struck pumping stations on the main east-west oil pipeline.", source: "Reuters" },
  { date: "2023-08-30", place: "Kaluga", country: "Russia", lat: 54.513, lon: 36.261, category: "military", summary: "Drones were reported over several regions around Moscow in coordinated raids.", source: "Reuters" },
];

const features = INCIDENTS.map((i, id) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [i.lon, i.lat] },
  properties: {
    id,
    date: i.date,
    place: i.place,
    country: i.country,
    category: i.category,
    summary: i.summary,
    source: i.source,
  },
}));

writeFileSync(join(OUT, "incidents.json"), JSON.stringify({ type: "FeatureCollection", features }));

const byCat = {};
for (const i of INCIDENTS) byCat[i.category] = (byCat[i.category] ?? 0) + 1;
const dates = INCIDENTS.map((i) => i.date).sort();
console.log("Skywatch international incidents (curated)");
console.log(`  incidents ${INCIDENTS.length}  ${JSON.stringify(byCat)}`);
console.log(`  range     ${dates[0]} -> ${dates[dates.length - 1]}`);
console.log(`  wrote ${OUT}/incidents.json`);
