// Fetches AirNow AQI forecasts (today, tomorrow) for a fixed list of
// Maryland-area cities and writes them to data/maryland-forecast.csv.
//
// AirNow's forecast endpoint takes one date per request and returns whatever
// forecast records exist for that date at that location -- there's no single
// call that returns a multi-day range, so this loops over 2 dates x 6 cities
// (12 requests total).
//
// Meant to be run by the GitHub Actions workflow in
// .github/workflows/update-forecast.yml, but works fine locally:
//
//   AIRNOW_API_KEY=yourkey node scripts/fetch-airnow-forecast.js
//
// Requires Node 18+ (built-in fetch).

const fs = require("fs");
const path = require("path");

const OUTPUT_PATH = path.join(__dirname, "..", "data", "maryland-forecast.csv");

// Representative ZIP code per city. AirNow forecasts by monitoring area, not
// exact address, so any ZIP within the city works -- these are just downtown/
// central ZIPs for each place.
const LOCATIONS = [
  { city: "Baltimore, MD", zip: "21201" },
  { city: "Annapolis, MD", zip: "21401" },
  { city: "Washington, DC", zip: "20001" },
  { city: "Elkton, MD", zip: "21921" },
  { city: "Cumberland, MD", zip: "21502" },
  { city: "Salisbury, MD", zip: "21801" },
];

async function main() {
  const apiKey = process.env.AIRNOW_API_KEY;
  if (!apiKey) {
    throw new Error("Missing AIRNOW_API_KEY environment variable");
  }

  const dates = [0, 1].map((offset) => addDays(new Date(), offset));
  const rows = [];

  for (const location of LOCATIONS) {
    for (const date of dates) {
      const dateStr = formatDate(date);
      let records;
      try {
        records = await fetchForecast(location.zip, dateStr, apiKey);
      } catch (err) {
        console.error(`Failed to fetch ${location.city} for ${dateStr}: ${err.message}`);
        continue;
      }

      if (records.length === 0) {
        // AirNow doesn't always have a forecast issued this far out -- record
        // that explicitly rather than silently having a gap in the CSV.
        rows.push({
          city: location.city,
          zip: location.zip,
          forecast_date: dateStr,
          parameter: "",
          aqi: "",
          category: "No forecast available",
          action_day: "",
          discussion: "",
        });
        continue;
      }

      for (const r of records) {
        rows.push({
          city: location.city,
          zip: location.zip,
          forecast_date: r.DateForecast ?? dateStr,
          parameter: r.ParameterName ?? "",
          aqi: r.AQI ?? "",
          category: r.Category?.Name ?? "",
          action_day: r.ActionDay ?? "",
          discussion: r.Discussion ?? "",
        });
      }
    }
  }

  const csv = toCsv(rows);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, csv);
  console.log(`Wrote ${rows.length} rows to ${OUTPUT_PATH}`);
}

async function fetchForecast(zip, dateStr, apiKey) {
  const url = new URL("https://www.airnowapi.org/aq/forecast/zipCode/");
  url.searchParams.set("format", "application/json");
  url.searchParams.set("zipCode", zip);
  url.searchParams.set("date", dateStr);
  url.searchParams.set("distance", "50");
  url.searchParams.set("API_KEY", apiKey);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`AirNow API returned ${res.status}`);
  }
  return res.json();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function toCsv(rows) {
  const headers = [
    "city",
    "zip",
    "forecast_date",
    "parameter",
    "aqi",
    "category",
    "action_day",
    "discussion",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
