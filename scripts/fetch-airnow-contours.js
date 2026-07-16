// Fetches AirNow's combined (Ozone + PM) AQI contour polygons for all of
// North America, paginating past the FeatureServer's 2000-record-per-request
// cap, and writes the merged result to data/airnow-contours-combined.geojson.
//
// Meant to be run by the GitHub Actions workflow in
// .github/workflows/update-airquality.yml, but works fine locally:
//
//   node scripts/fetch-airnow-contours.js
//
// No API key needed -- this is a public EPA-hosted ArcGIS Feature Service.
// Requires Node 18+ (built-in fetch).

const fs = require("fs");
const path = require("path");

const SERVICE_URL =
  "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/AirNowLatestContoursCombined/FeatureServer/0/query";
const PAGE_SIZE = 2000; // matches the service's maxRecordCount
const MAX_PAGES = 50; // safety cap so a bug can't loop forever (100k features)
const OUTPUT_PATH = path.join(
  __dirname,
  "..",
  "data",
  "airnow-contours-combined.geojson"
);

async function main() {
  const features = await fetchAllPages();

  const geojson = {
    type: "FeatureCollection",
    generated_at: new Date().toISOString(),
    features,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(geojson));
  console.log(`Wrote ${features.length} features to ${OUTPUT_PATH}`);
}

async function fetchAllPages() {
  const allFeatures = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(SERVICE_URL);
    url.searchParams.set("where", "1=1");
    url.searchParams.set("outFields", "*");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
    url.searchParams.set("f", "geojson");

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`AirNow contour service returned ${res.status}`);
    }
    const data = await res.json();

    if (data.error) {
      throw new Error(`AirNow contour service error: ${JSON.stringify(data.error)}`);
    }

    const pageFeatures = data.features || [];
    allFeatures.push(...pageFeatures);
    console.log(`Page ${page}: offset ${offset}, got ${pageFeatures.length} features`);

    // Fewer features than a full page means we've reached the end
    if (pageFeatures.length < PAGE_SIZE) {
      return allFeatures;
    }

    offset += PAGE_SIZE;
  }

  console.warn(
    `Hit MAX_PAGES (${MAX_PAGES}) without reaching the end -- data may be incomplete. ` +
      `Consider raising MAX_PAGES if this persists.`
  );
  return allFeatures;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
