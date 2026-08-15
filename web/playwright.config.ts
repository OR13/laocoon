import { defineConfig, devices } from "@playwright/test";

/**
 * Drives the built static site, not the dev server: what ships to Pages is what
 * gets checked. `bun run site` must have run first.
 *
 * Chromium is launched with SwiftShader so WebGL is actually available — the
 * graph degrades to a text panel without it, and a test that silently exercised
 * the fallback would pass while the graph was broken.
 */
export default defineConfig({
  // Not ./tests — `bun test` matches that path by substring and tries to load
  // Playwright specs as Bun tests.
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "../.git-ignored/playwright",
  use: {
    baseURL: "http://127.0.0.1:8123",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "python3 -m http.server 8123 --bind 127.0.0.1 --directory ../site",
    url: "http://127.0.0.1:8123/index.html",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
