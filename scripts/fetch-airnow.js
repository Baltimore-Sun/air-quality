// Fetches current AirNow observations for a Maryland bounding box and writes
// them to data/maryland-airnow.geojson. Meant to be run by the GitHub Actions
// workflow in .github/workflows/update-airquality.yml, but works fine locally:
//
//   AIRNOW_API_KEY=yourkey node scripts/fetch-airnow.js
//
// Requires Node 18+ (built-in fetch).

const fs = require("fs");
const path = require("path");

const MARYLAND_BBOX = "-79.5,37.8,-74.9,39.9"; // minLong,minLat,maxLong,maxLat (padded to catch border stations)
const OUTPUT_PATH = path.join(__dirname, "..", "data", "maryland-airnow.geojson");

async function main() {
  const apiKey = process.env.AIRNOW_API_KEY;
  if (!apiKey) {
    throw new Error("Missing AIRNOW_API_KEY environment variable");
  }

  const geojson = await fetchAirNowAsGeoJSON(apiKey);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));
  console.log(`Wrote ${geojson.features.length} features to ${OUTPUT_PATH}`);
}

async function fetchAirNowAsGeoJSON(apiKey) {
  // AirNow's bounding-box endpoint requires an explicit UTC date/hour window,
  // it has no "give me the latest" mode. We ask for the last 2 hours so we
  // still get a reading even if the most recent hour hasn't posted yet.
  const now = new Date();
  const end = formatAirNowDate(now);
  const start = formatAirNowDate(new Date(now.getTime() - 2 * 60 * 60 * 1000));

  const url = new URL("https://www.airnowapi.org/aq/data/");
  url.searchParams.set("startDate", start);
  url.searchParams.set("endDate", end);
  url.searchParams.set("parameters", "OZONE,PM25,PM10,CO,NO2,SO2");
  url.searchParams.set("BBOX", MARYLAND_BBOX);
  url.searchParams.set("dataType", "A"); // AQI values (use "C" for raw concentrations instead)
  url.searchParams.set("format", "application/json");
  url.searchParams.set("verbose", "1");
  url.searchParams.set("monitorType", "2");
  url.searchParams.set("includerawconcentrations", "0");
  url.searchParams.set("API_KEY", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`AirNow API returned ${res.status}: ${await res.text()}`);
  }
  const records = await res.json();

  // Keep only the most recent reading per site+parameter combo
  const latestBySiteParam = new Map();
  for (const r of records) {
    const key = `${r.Latitude},${r.Longitude},${r.Parameter}`;
    const existing = latestBySiteParam.get(key);
    if (!existing || r.UTC > existing.UTC) {
      latestBySiteParam.set(key, r);
    }
  }

  const features = Array.from(latestBySiteParam.values()).map((r) => ({
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [r.Longitude, r.Latitude],
    },
    properties: {
      site_name: r.SiteName,
      agency: r.AgencyName,
      parameter: r.Parameter,
      aqi: r.AQI,
      category: r.Category?.Name ?? null,
      utc_observed: r.UTC,
      full_aqsid: r.FullAQSCode,
    },
  }));

  return {
    type: "FeatureCollection",
    generated_at: new Date().toISOString(),
    features,
  };
}

function formatAirNowDate(date) {
  // AirNow wants "YYYY-MM-DDTHH" in UTC
  return date.toISOString().slice(0, 13);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
