import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: "http://localhost:1420",
    headless: true,
    viewport: { width: 1440, height: 920 },
    actionTimeout: 10000,
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
