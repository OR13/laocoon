import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Readability checks for the WebGL graph.
 *
 * "Does it render" is not the question — a blank canvas and a hairball both
 * render. These assert the properties that make a graph *legible*: nodes inside
 * the viewport, nodes not stacked on top of each other, ink actually on the
 * canvas, and every interaction changing what it claims to change.
 *
 * sigma draws to WebGL, so there is no DOM to assert against. The component
 * exposes `window.__laocoon = { renderer, graph }` for exactly this.
 */

// Absolute, off the spec file: Playwright resolves screenshot paths against
// the invoking CWD, which differs depending on where the runner was started.
const SHOTS = join(import.meta.dirname, "../../.git-ignored/graph-shots");
mkdirSync(SHOTS, { recursive: true });

interface Report {
  nodes: number;
  edges: number;
  /** Nodes whose centre lands inside the canvas box. */
  onScreen: number;
  /** Node pairs drawn overlapping by more than half a radius. */
  overlaps: number;
  /** Spread of node centres, as a share of the canvas box. */
  fillX: number;
  fillY: number;
  /** Share of sampled canvas pixels that differ from the surface colour. */
  ink: number;
  tiers: Record<string, number>;
}

async function readGraph(page: Page): Promise<Report> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __laocoon?: { renderer: any; graph: any } }).__laocoon;
    if (!hook) throw new Error("graph hook missing — WebGL fallback, or sigma never mounted");
    const { renderer, graph } = hook;
    const { width, height } = renderer.getDimensions();

    const points: { x: number; y: number; r: number; tier: string }[] = [];
    graph.forEachNode((key: string, attrs: Record<string, unknown>) => {
      const display = renderer.getNodeDisplayData(key);
      if (!display) return;
      const p = renderer.framedGraphToViewport(display);
      points.push({
        x: p.x,
        y: p.y,
        r: renderer.scaleSize ? renderer.scaleSize(display.size) : (display.size as number),
        tier: String(attrs.tier),
      });
    });

    const onScreen = points.filter(
      (p) => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height,
    ).length;

    let overlaps = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!;
        const b = points[j]!;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < (a.r + b.r) * 0.5) overlaps++;
      }
    }

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const fillX = points.length ? (Math.max(...xs) - Math.min(...xs)) / width : 0;
    const fillY = points.length ? (Math.max(...ys) - Math.min(...ys)) / height : 0;

    // Sample the composed canvas: WebGL nodes/edges and the 2D label layer are
    // separate canvases, so read every one sigma made and count any pixel that
    // is not the surface behind it.
    const canvases = Array.from(
      (renderer.getContainer() as HTMLElement).querySelectorAll("canvas"),
    ) as HTMLCanvasElement[];
    let painted = 0;
    let sampled = 0;
    for (const c of canvases) {
      const ctx = c.getContext("2d");
      if (!ctx) continue; // WebGL canvas — read below via readPixels instead
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < data.length; i += 4 * 37) {
        sampled++;
        if (data[i + 3]! > 8) painted++;
      }
    }
    const gl = canvases
      .map((c) => c.getContext("webgl2") ?? c.getContext("webgl"))
      .find(Boolean) as WebGLRenderingContext | undefined;
    if (gl) {
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      for (let i = 0; i < buf.length; i += 4 * 37) {
        sampled++;
        if (buf[i + 3]! > 8) painted++;
      }
    }

    const tiers: Record<string, number> = {};
    for (const p of points) tiers[p.tier] = (tiers[p.tier] ?? 0) + 1;

    return {
      nodes: graph.order,
      edges: graph.size,
      onScreen,
      overlaps,
      fillX,
      fillY,
      ink: sampled ? painted / sampled : 0,
      tiers,
    };
  });
}

/**
 * Label boxes that collide, as a share of the labels drawn.
 *
 * The geometry checks above all passed while the centre of the graph was an
 * unreadable pile of overlapping subject lines — node positions were fine, the
 * *text* was the problem. sigma keeps one label per grid cell, which does
 * nothing when a label is several cells wide.
 */
async function labelCollisions(page: Page): Promise<{ drawn: number; colliding: number }> {
  return page.evaluate(() => {
    const { renderer, graph } = (window as unknown as { __laocoon: { renderer: any; graph: any } })
      .__laocoon;
    const reduce = renderer.getSetting("nodeReducer");
    const font = `${renderer.getSetting("labelSize") ?? 14}px ${renderer.getSetting("labelFont") ?? "sans-serif"}`;
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = font;

    // sigma decides which labels survive its grid; ask it, rather than
    // counting every label the reducer emitted. `displayedNodeLabels` is
    // private in the typings but present at runtime, and it is the only
    // honest answer to "what is on screen".
    const drawnKeys: Set<string> | null = renderer.displayedNodeLabels ?? null;

    const boxes: { x1: number; y1: number; x2: number; y2: number }[] = [];
    graph.forEachNode((key: string, attrs: Record<string, unknown>) => {
      if (drawnKeys && !drawnKeys.has(key)) return;
      const data = reduce ? reduce(key, attrs) : attrs;
      const label = data?.label;
      if (!label) return;
      const display = renderer.getNodeDisplayData(key);
      if (!display) return;
      const p = renderer.framedGraphToViewport(display);
      const w = measure.measureText(String(label)).width;
      boxes.push({ x1: p.x, y1: p.y - 7, x2: p.x + w, y2: p.y + 7 });
    });

    let colliding = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) {
          colliding++;
          break;
        }
      }
    }
    return { drawn: boxes.length, colliding };
  });
}

/** Click the node closest to a graph-space target, in viewport pixels. */
async function clickTier(page: Page, tier: string, index = 0): Promise<string | null> {
  const at = await page.evaluate(
    ({ tier, index }) => {
      const hook = (window as unknown as { __laocoon?: { renderer: any; graph: any } }).__laocoon!;
      const { renderer, graph } = hook;
      const keys: string[] = [];
      graph.forEachNode((k: string, a: Record<string, unknown>) => {
        if (a.tier === tier) keys.push(k);
      });
      // Biggest first, so the click lands on something a reader would aim at.
      keys.sort(
        (a, b) => (graph.getNodeAttribute(b, "size") as number) - (graph.getNodeAttribute(a, "size") as number),
      );
      const key = keys[index];
      if (!key) return null;
      const p = renderer.framedGraphToViewport(renderer.getNodeDisplayData(key));
      return { key, x: p.x, y: p.y, label: graph.getNodeAttribute(key, "label") as string };
    },
    { tier, index },
  );
  if (!at) return null;
  // sigma stacks several canvases; the mouse layer is last and is the one that
  // listens. Scroll it into view first — page.mouse works in viewport pixels
  // and will otherwise click empty space above the graph.
  const canvas = page.locator(".sigma-mouse, canvas").last();
  await page.evaluate(() =>
    document.querySelector("canvas")?.scrollIntoView({ block: "center" }),
  );
  await page.waitForTimeout(150);
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + at.x, box.y + at.y);
  return at.label;
}

/** Screenshots are of the graph, so put the graph on screen first. */
async function shoot(page: Page, name: string) {
  // Scroll by script, not scrollIntoViewIfNeeded: Playwright's actionability
  // check waits for the element to stop moving, and a sigma canvas repaints
  // continuously, so it never settles and the call times out.
  await page.evaluate(() =>
    document.querySelector("canvas")?.scrollIntoView({ block: "center" }),
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/${name}` });
}

/**
 * Wait for the graph, and by default get the review panel out of the way.
 *
 * The panel scrolls to its first focus item 700ms after load. A test that had
 * already scrolled the canvas into view and computed click coordinates then
 * had the page move underneath it — the click landed on empty space, and only
 * when the suite ran in sequence, so it read as a flake.
 */
async function settle(page: Page, keepReview = false) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __laocoon?: unknown }).__laocoon),
    null,
    { timeout: 20_000 },
  );
  if (!keepReview) {
    await page.waitForTimeout(900);
    await page.keyboard.press("Escape");
  }
  // The expand animation runs 520ms; give it room plus a paint.
  await page.waitForTimeout(900);
}

test.describe("graph explorer", () => {
  let errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
  });

  test("renders with WebGL, not the fallback", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.getByText("The graph needs WebGL")).toHaveCount(0);
    await settle(page);
    const r = await readGraph(page);
    console.log("collapsed:", JSON.stringify(r));
    expect(r.nodes).toBeGreaterThan(0);
    expect(r.ink).toBeGreaterThan(0.001); // not a blank canvas
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("nodes sit inside the viewport and use the space", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    const r = await readGraph(page);
    await shoot(page, "01-collapsed.png");
    // Every node visible: sigma's autoscale should have framed the whole graph.
    expect(r.onScreen / r.nodes).toBeGreaterThan(0.95);
    // ...and it should not be a dot in the middle of an empty box.
    expect(r.fillX).toBeGreaterThan(0.3);
    expect(r.fillY).toBeGreaterThan(0.3);
  });

  test("nodes are not stacked on top of each other", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    const r = await readGraph(page);
    console.log(`collapsed overlaps: ${r.overlaps} of ${r.nodes} nodes`);
    expect(r.overlaps / Math.max(1, r.nodes)).toBeLessThan(0.5);
  });

  test("expanding a topic adds threads and stays readable", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    const before = await readGraph(page);

    const label = await clickTier(page, "topic", 0);
    expect(label, "no topic node to click").not.toBeNull();
    await settle(page);
    const after = await readGraph(page);
    await shoot(page, "02-one-topic.png");
    console.log(`expanded "${label}":`, JSON.stringify(after));

    expect(after.nodes).toBeGreaterThan(before.nodes);
    expect(after.tiers.thread ?? 0).toBeGreaterThan(0);
    expect(after.onScreen / after.nodes).toBeGreaterThan(0.95);
    expect(after.overlaps / after.nodes).toBeLessThan(0.5);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("clicking a thread fills the detail panel with a working archive link", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    await clickTier(page, "topic", 0);
    await settle(page);
    await clickTier(page, "thread", 0);
    await page.waitForTimeout(300);
    const aside = page.getByTestId("detail-panel");
    await expect(aside.getByText("Messages", { exact: true })).toBeVisible();
    const link = aside.getByRole("link", { name: /mail archive/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /mailarchive\.ietf\.org\/arch\/msg\//);
  });

  test("expand all topics does not produce a hairball", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    await page.getByRole("button", { name: "Expand all topics" }).click();
    await settle(page);
    const r = await readGraph(page);
    await shoot(page, "03-all-topics.png");
    console.log("all topics:", JSON.stringify(r));
    expect(r.onScreen / r.nodes).toBeGreaterThan(0.95);
    expect(r.overlaps / r.nodes).toBeLessThan(1.0);
  });

  test("the public page offers no people control", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    await page.getByRole("button", { name: "Expand all topics" }).click();
    await settle(page);
    // The public page ships no participation rows, so the control is absent
    // rather than present-and-inert. On the private page it is there and works.
    await expect(page.getByRole("button", { name: /people/i })).toHaveCount(0);
    const r = await readGraph(page);
    await shoot(page, "04-people.png");
    console.log("no people on the public page:", JSON.stringify(r));
    expect(r.onScreen / r.nodes).toBeGreaterThan(0.95);
    expect(r.overlaps / r.nodes).toBeLessThan(1.5);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a thread is drawn nearer its own topic than any other", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    await page.getByRole("button", { name: "Expand all topics" }).click();
    await settle(page);
    const r = await page.evaluate(() => {
      const { renderer, graph } = (window as unknown as { __laocoon: { renderer: any; graph: any } })
        .__laocoon;
      const topics: { cluster: string; x: number; y: number }[] = [];
      graph.forEachNode((k: string, a: Record<string, unknown>) => {
        if (a.tier !== "topic") return;
        const p = renderer.framedGraphToViewport(renderer.getNodeDisplayData(k));
        topics.push({ cluster: String(a.cluster), x: p.x, y: p.y });
      });
      let checked = 0;
      let correct = 0;
      graph.forEachNode((k: string, a: Record<string, unknown>) => {
        if (a.tier !== "thread") return;
        const own = topics.find((t) => t.cluster === a.cluster);
        if (!own) return;
        const p = renderer.framedGraphToViewport(renderer.getNodeDisplayData(k));
        const d = (t: { x: number; y: number }) => Math.hypot(p.x - t.x, p.y - t.y);
        const nearest = topics.reduce((best, t) => (d(t) < d(best) ? t : best), topics[0]!);
        checked++;
        if (nearest.cluster === a.cluster) correct++;
      });
      return { checked, correct };
    });
    console.log("threads nearest own topic:", JSON.stringify(r));
    expect(r.checked).toBeGreaterThan(50);
    // The force layout scored well under half here: it pulled every thread to
    // the barycentre and pushed the topics out to a rim.
    expect(r.correct / r.checked).toBeGreaterThan(0.9);
  });

  test("labels do not print on top of each other", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page);
    const collapsed = await labelCollisions(page);
    console.log("collapsed labels:", JSON.stringify(collapsed));
    expect(collapsed.drawn).toBeGreaterThan(0); // a graph with no labels is not the fix
    expect(collapsed.colliding / collapsed.drawn).toBeLessThan(0.15);

    await page.getByRole("button", { name: "Expand all topics" }).click();
    await settle(page);
    const expanded = await labelCollisions(page);
    console.log("all-topics labels:", JSON.stringify(expanded));
    await shoot(page, "06-labels.png");
    expect(expanded.drawn).toBeGreaterThan(0);
    expect(expanded.colliding / expanded.drawn).toBeLessThan(0.15);
  });

  test("the review panel shifts the page instead of covering it", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page, true);
    const panel = page.getByRole("complementary", { name: "Design review" });
    await expect(panel).toBeVisible();
    const panelBox = (await panel.boundingBox())!;
    // Every card on the page must end before the panel starts.
    const overlapping = await page.evaluate((left: number) => {
      const cards = Array.from(document.querySelectorAll("main *")).filter(
        (el) => el.clientWidth > 200 && el.clientHeight > 60,
      );
      return cards.filter((el) => el.getBoundingClientRect().right > left + 1).length;
    }, panelBox.x);
    expect(overlapping, "content runs underneath the review panel").toBe(0);
  });

  test("every design-review focus points at something on the page", async ({ page }) => {
    await page.goto("/index.html");
    await settle(page, true);
    // A focus item whose anchor is absent made its button silently do nothing.
    // review.json shipped one for three cycles.
    const dead = await page.locator("text=target missing").count();
    expect(dead, "a review focus targets an anchor that is not on the page").toBe(0);
  });

  test("dark mode paints the graph, not a black rectangle", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/index.html");
    await settle(page);
    const r = await readGraph(page);
    await shoot(page, "05-dark.png");
    expect(r.ink).toBeGreaterThan(0.001);
  });
});
