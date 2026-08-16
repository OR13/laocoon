import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Checks for the reply network — the one picture on the overview.
 *
 * These replace the suite that covered the topic graph, which was removed: it
 * drew a hierarchy as a node-link diagram, and the operator called the result
 * useless. The checks that survived are the ones about *legibility* rather
 * than about that particular graph — WebGL actually in use, nodes inside the
 * viewport, no label printed over another, every control doing something.
 * Those were the checks that found real defects.
 */

const SHOTS = join(import.meta.dirname, "../../.git-ignored/graph-shots");
mkdirSync(SHOTS, { recursive: true });

async function settle(page: Page, keepReview = false) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __laocoon?: unknown }).__laocoon),
    null,
    { timeout: 25_000 },
  );
  if (!keepReview) {
    await page.waitForTimeout(900);
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(900);
}

interface Report {
  nodes: number;
  edges: number;
  onScreen: number;
  overlaps: number;
  fillX: number;
  fillY: number;
  labels: number;
  collidingLabels: number;
}

async function read(page: Page): Promise<Report> {
  return page.evaluate(() => {
    const { renderer, graph } = (window as unknown as { __laocoon: { renderer: any; graph: any } })
      .__laocoon;
    const { width, height } = renderer.getDimensions();
    const reduce = renderer.getSetting("nodeReducer");
    const drawnKeys: Set<string> | null = renderer.displayedNodeLabels ?? null;
    const measure = document.createElement("canvas").getContext("2d")!;
    const size = renderer.getSetting("labelSize") ?? 14;
    measure.font = `${size}px ${renderer.getSetting("labelFont") ?? "sans-serif"}`;

    const points: { x: number; y: number; r: number }[] = [];
    const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
    graph.forEachNode((key: string, attrs: Record<string, unknown>) => {
      const display = renderer.getNodeDisplayData(key);
      if (!display) return;
      const p = renderer.framedGraphToViewport(display);
      const r = renderer.scaleSize ? renderer.scaleSize(display.size) : (display.size as number);
      points.push({ x: p.x, y: p.y, r });
      if (drawnKeys && !drawnKeys.has(key)) return;
      const label = (reduce ? reduce(key, attrs) : attrs)?.label;
      if (!label) return;
      const w = measure.measureText(String(label)).width;
      boxes.push({ x1: p.x, y1: p.y - size, x2: p.x + w, y2: p.y + size });
    });

    let overlaps = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!;
        const b = points[j]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < (a.r + b.r) * 0.5) overlaps++;
      }
    }
    let collidingLabels = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) {
          collidingLabels++;
          break;
        }
      }
    }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return {
      nodes: graph.order,
      edges: graph.size,
      onScreen: points.filter((p) => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height).length,
      overlaps,
      fillX: points.length ? (Math.max(...xs) - Math.min(...xs)) / width : 0,
      fillY: points.length ? (Math.max(...ys) - Math.min(...ys)) / height : 0,
      labels: boxes.length,
      collidingLabels,
    };
  });
}

test.describe("reply network", () => {
  let errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
  });

  test("draws with WebGL and no console errors", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.getByText("needs WebGL")).toHaveCount(0);
    await settle(page);
    const r = await read(page);
    console.log("network:", JSON.stringify(r));
    expect(r.nodes).toBeGreaterThan(20);
    expect(r.edges).toBeGreaterThan(20);
    // `node:crypto` reached the browser once and base64url threw here.
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("nodes sit inside the viewport and use the space", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    const r = await read(page);
    await page.screenshot({ path: `${SHOTS}/network.png` });
    expect(r.onScreen / r.nodes).toBeGreaterThan(0.95);
    expect(r.fillX).toBeGreaterThan(0.3);
    expect(r.fillY).toBeGreaterThan(0.3);
  });

  test("names never print on top of each other", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    const r = await read(page);
    console.log(`labels: ${r.labels} drawn, ${r.collidingLabels} colliding`);
    expect(r.labels).toBeGreaterThan(0);
    expect(r.collidingLabels).toBe(0);
  });

  test("the edge filter changes what is drawn", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    const repeated = await read(page);
    await page.getByRole("button", { name: "Every reply" }).click();
    await page.waitForTimeout(1800);
    const all = await read(page);
    console.log(`filter: repeated ${repeated.nodes} people, every reply ${all.nodes}`);
    // 444 of 603 pairs answered each other exactly once.
    expect(all.nodes).toBeGreaterThan(repeated.nodes);
  });

  test("clicking a person names them", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    const at = await page.evaluate(() => {
      const { renderer, graph } = (window as unknown as { __laocoon: { renderer: any; graph: any } })
        .__laocoon;
      const key = graph
        .nodes()
        .sort(
          (a: string, b: string) =>
            graph.getNodeAttribute(b, "messages") - graph.getNodeAttribute(a, "messages"),
        )[0];
      const p = renderer.framedGraphToViewport(renderer.getNodeDisplayData(key));
      return { x: p.x, y: p.y, name: graph.getNodeAttribute(key, "label") };
    });
    const canvas = page.locator("canvas").last();
    await page.evaluate(() =>
      document.querySelector("canvas")?.scrollIntoView({ block: "center" }),
    );
    await page.waitForTimeout(300);
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + at.x, box.y + at.y);
    await page.waitForTimeout(400);
    await expect(page.getByText("messages sent", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(String(at.name), { exact: false }).first()).toBeVisible();
  });

  test("reset view returns the camera to the default framing", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    const ratio = () =>
      page.evaluate(
        () =>
          (window as unknown as { __laocoon: { renderer: any } }).__laocoon.renderer.getCamera()
            .ratio,
      );
    await page.evaluate(() =>
      (window as unknown as { __laocoon: { renderer: any } }).__laocoon.renderer
        .getCamera()
        .setState({ ratio: 4, x: 0.9 }),
    );
    expect(await ratio()).toBeCloseTo(4, 1);
    await page.getByRole("button", { name: "Reset view" }).click();
    await page.waitForTimeout(700);
    expect(await ratio()).toBeCloseTo(1, 1);
  });

  test("no sender hash reaches the published page", async ({ page }) => {
    // The network is published with names; a sha256 sender id alongside them
    // would let the public file be joined to the private tables.
    await page.goto("/index.html");
    await settle(page);
    const html = await page.content();
    expect(html).not.toMatch(/sha256:[0-9a-f]{64}/);
  });

  test("every design-review focus points at something on the page", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page, true);
    expect(await page.locator("text=target missing").count()).toBe(0);
  });

  test("dark mode paints the network", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/index.html");
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/network-dark.png` });
    const r = await read(page);
    expect(r.nodes).toBeGreaterThan(20);
  });
});
