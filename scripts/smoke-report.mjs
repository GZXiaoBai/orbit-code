import fs from "node:fs";
import path from "node:path";

export const SMOKE_REPORT_DIR = path.resolve("docs/smoke");

export function timestampId(prefix, date = new Date()) {
  return `${prefix}-${date.toISOString().replace(/[:.]/g, "-")}`;
}

export function writeSmokeReport(smokeName, report, label = "Smoke report") {
  fs.mkdirSync(SMOKE_REPORT_DIR, { recursive: true });
  const latestPath = path.join(SMOKE_REPORT_DIR, `latest-${smokeName}.json`);
  fs.writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`);

  let historyPath;
  if (process.env.ORBIT_SMOKE_KEEP_HISTORY === "1") {
    const historyId = report.id || timestampId(smokeName);
    historyPath = path.join(SMOKE_REPORT_DIR, `${historyId}.json`);
    fs.writeFileSync(historyPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(`${label}: ${latestPath}`);
  if (historyPath) console.log(`Historical smoke report: ${historyPath}`);
  return { latestPath, historyPath };
}
