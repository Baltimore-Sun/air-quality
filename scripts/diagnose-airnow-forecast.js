// Diagnostic dump of AirNow's forecast API -- writes every raw field the API
// returns (ReportingArea, DateIssue, Latitude/Longitude, all pollutants, not
// just PM2.5/O3, no "most severe wins" collapsing) to a SEPARATE file from
// the production table, so you can compare against what airnow.gov shows
// without touching the clean output CSV.
//
// Run manually whenever you need to check a discrepancy -- this is not meant
// to run on the hourly/daily schedule the production workflow uses.
//
//   AIRNOW_API_KEY=yourkey node scripts/diagnose-airnow-forecast.js
//
// Requires Node 18+ (built-in fetch).

const fs = require("fs");
const path = require("path");

const OUTPUT_PATH = path.join(__dirname, "..", "data", "maryland-forecast-debug.csv");

// Same city/ZIP list as the production script -- keep these in sync manually
// if you add/remove locations there.
const LOCATIONS = [
  { city: "Baltimore", zip: "21201" },
  { city: "Annapolis", zip: "21401" },
  { city: "Washington", zip: "20001" },
  { city: "Elkton", zip: "21921" },
  { city: "Salisbury", zip: "21801" },
  { city: "Cumberland", zip: "21502" },
];

async function main() {
  const apiKey = process.env.AIRNOW_API_KEY;
  if (!apiKey) {
    throw new Error("Missing AIRNOW_API_KEY environment variable");
  }

  const dates = [0, 1].map((offset) => formatDate(addDays(new Date(), offset)));
  const rows = [];

  for (const location of LOCATIONS) {
    for (const dateStr of dates) {
      let records;
      let fetchedAt = new Date().toISOString();
      try {
        records = await fetchForecast(location.zip, dateStr, apiKey);
      } catch (err) {
        rows.push({
          queried_city: location.city,
          queried_zip: location.zip,
          queried_date: dateStr,
          fetched_at_utc: fetchedAt,
          error: err.message,
        });
        continue;
      }

      if (records.length === 0) {
        rows.push({
          queried_city: location.city,
          queried_zip: location.zip,
          queried_date: dateStr,
          fetched_at_utc: fetchedAt,
          error: "empty response (no forecast records returned)",
        });
        continue;
      }

      for (const r of records) {
        rows.push({
          queried_city: location.city,
          queried_zip: location.zip,
          queried_date: dateStr,
          fetched_at_utc: fetchedAt,
          error: "",
          DateIssue: r.DateIssue ?? "",
          DateForecast: r.DateForecast ?? "",
          ReportingArea: r.ReportingArea ?? "",
          StateCode: r.StateCode ?? "",
          Latitude: r.Latitude ?? "",
          Longitude: r.Longitude ?? "",
          ParameterName: r.ParameterName ?? "",
          AQI: r.AQI ?? "",
          CategoryNumber: r.Category?.Number ?? "",
          CategoryName: r.Category?.Name ?? "",
          ActionDay: r.ActionDay ?? "",
          Discussion: r.Discussion ?? "",
        });
      }
    }
  }

  const csv = toCsv(rows);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, csv);
  console.log(`Wrote ${rows.length} raw rows to ${OUTPUT_PATH}`);
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
  // Union of all keys seen, so partial rows (errors) still line up under the
  // right headers instead of shifting columns.
  const headers = [
    "queried_city",
    "queried_zip",
    "queried_date",
    "fetched_at_utc",
    "error",
    "DateIssue",
    "DateForecast",
    "ReportingArea",
    "StateCode",
    "Latitude",
    "Longitude",
    "ParameterName",
    "AQI",
    "CategoryNumber",
    "CategoryName",
    "ActionDay",
    "Discussion",
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
