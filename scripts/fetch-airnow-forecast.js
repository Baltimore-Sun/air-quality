// Fetches AirNow AQI forecasts (today, tomorrow) for a fixed list of
// Maryland-area cities and writes a pivoted CSV to data/maryland-forecast.csv:
// one row per city, one column per date, cell = combined PM2.5/O3 category.
//
// Cell format rules:
//   - Both PM2.5 and O3 forecast, different categories:
//       "Moderate (PM 2.5)/Unhealthy for Sensitive Groups (O3)"
//   - Both forecast, same category: just the category name, e.g. "Moderate"
//   - Only one pollutant forecast (e.g. no ozone season): just that category
//   - Neither forecast: "No forecast available"
//   - If a city has more than one ZIP entry in LOCATIONS, the more severe
//     category wins for each pollutant.
//
// AirNow's forecast endpoint takes one date per request and returns whatever
// forecast records exist for that date at that location -- there's no single
// call that returns a multi-day range, so this loops over 2 dates x however
// many (city, zip) entries are in LOCATIONS.
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
// exact address, so any ZIP within the city works. Add more than one entry
// with the same `city` value if you want to cover multiple ZIPs for one
// city -- the script will take the more severe category per pollutant.
const LOCATIONS = [
  { city: "Baltimore", zip: "21201" },
  { city: "Annapolis", zip: "21401" },
  { city: "Washington", zip: "20001" },
  { city: "Elkton", zip: "21921" },
  { city: "Salisbury", zip: "21801" },
  { city: "Cumberland", zip: "21502" },
];

// AirNow's standard AQI category severity ranking, low to high.
const CATEGORY_SEVERITY = {
  Good: 1,
  Moderate: 2,
  "Unhealthy for Sensitive Groups": 3,
  Unhealthy: 4,
  "Very Unhealthy": 5,
  Hazardous: 6,
};

async function main() {
  const apiKey = process.env.AIRNOW_API_KEY;
  if (!apiKey) {
    throw new Error("Missing AIRNOW_API_KEY environment variable");
  }

  const dates = [0, 1].map((offset) => formatDate(addDays(new Date(), offset)));

  // grouped[city][date][pollutant] = { category, severity }
  const grouped = {};

  for (const location of LOCATIONS) {
    for (const dateStr of dates) {
      let records;
      try {
        records = await fetchForecast(location.zip, dateStr, apiKey);
      } catch (err) {
        console.error(`Failed to fetch ${location.city} (${location.zip}) for ${dateStr}: ${err.message}`);
        continue;
      }

      for (const r of records) {
        const pollutant = normalizeParameter(r.ParameterName);
        const category = r.Category?.Name;
        if (!pollutant || !category) continue;

        const severity = CATEGORY_SEVERITY[category] ?? 0;

        grouped[location.city] ??= {};
        grouped[location.city][dateStr] ??= {};
        const existing = grouped[location.city][dateStr][pollutant];
        if (!existing || severity > existing.severity) {
          grouped[location.city][dateStr][pollutant] = { category, severity };
        }
      }
    }
  }

  const csv = toCsv(LOCATIONS, dates, grouped);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, csv);
  console.log(`Wrote forecast table to ${OUTPUT_PATH}`);
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

function normalizeParameter(name) {
  if (!name) return null;
  const upper = name.toUpperCase().replace(/[\s.]/g, "");
  if (upper.includes("PM25")) return "PM2.5";
  if (upper.includes("OZONE") || upper === "O3") return "O3";
  return null; // ignore anything else (e.g. PM10, CO) for this table
}

function formatCell(cityDates) {
  if (!cityDates) return "No forecast available";
  const pm = cityDates["PM2.5"];
  const o3 = cityDates["O3"];

  if (!pm && !o3) return "No forecast available";
  if (pm && o3) {
    if (pm.category === o3.category) return pm.category;
    return `${pm.category} (PM 2.5)/${o3.category} (O3)`;
  }
  return (pm || o3).category;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10); // "YYYY-MM-DD", used for the API call
}

function formatDateLabel(dateStr) {
  // "2026-07-16" -> "July 16"
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

function toCsv(locations, dates, grouped) {
  // Preserve first-seen order of cities from LOCATIONS, de-duplicated (in
  // case multiple ZIP entries share the same city name).
  const cities = [...new Set(locations.map((l) => l.city))];

  const headers = ["City", ...dates.map(formatDateLabel)];
  const lines = [headers.map(csvEscape).join(",")];

  for (const city of cities) {
    const row = [city, ...dates.map((dateStr) => formatCell(grouped[city]?.[dateStr]))];
    lines.push(row.map(csvEscape).join(","));
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
