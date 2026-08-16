"use client";

/**
 * One picture: who replies to whom.
 *
 * **Why a force layout is right here and was wrong twice before.** The two
 * graphs the operator rejected drew topic-contains-thread, a hierarchy with no
 * edges between the things being positioned — so the layout had nothing to
 * lay out, and forceAtlas2 produced a rim of topics around a pile of threads.
 * Person-replies-to-person is an actual network: an edge means one account
 * answered another, and a force layout puts accounts that answer each other
 * near each other. That is the entire content of the picture, and it is what
 * Sack's Conversation Map computes first for a mailing list.
 *
 * Reading it:
 *
 *   position   people who reply to each other sit together
 *   size       messages sent — a count, not a rating
 *   colour     whether the IETF has a record of the account
 *
 * A dense coloured core with grey satellites that only touch each other is the
 * shape the operator is looking for. A grey node deep inside the core is
 * someone new doing well. Neither is a claim about how anything was written.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { NodeCircleProgram } from "sigma/rendering";
import { NodeSquareProgram } from "@sigma/node-square";
import { useTheme } from "next-themes";
import { tidySubject } from "@/lib/graph-model";
import {
  BAND_META, BAND_ORDER, FILTERS, UTILITY_META, UTILITY_ORDER, type Band, type FilterId,
  type NetworkEdge, type NetworkPerson, type NetworkThread, type Utility,
} from "@/lib/scores";

const cssVar = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/**
 * The label box drawn under the pointer.
 *
 * sigma's default paints a **white** rounded box and then writes the label in
 * whatever `labelColor` says. In dark mode that is near-white ink on a white
 * box: hovering a node made its own name disappear. This reads the theme's
 * surface and ink at draw time, so the box always contrasts with the text
 * inside it.
 */
function drawHover(
  context: CanvasRenderingContext2D,
  data: { x: number; y: number; size: number; label: string | null },
): void {
  if (!data.label) return;
  const surface = cssVar("--card") || "#ffffff";
  const ink = cssVar("--cy-ink") || "#1c1917";
  const edge = cssVar("--thread-line") || "#c3c2bb";
  const size = 14;
  context.font = `${size}px ui-sans-serif, system-ui, sans-serif`;
  const width = context.measureText(data.label).width + 16;
  const height = size + 12;
  const x = data.x + data.size + 4;
  const y = data.y - height / 2;

  context.beginPath();
  context.fillStyle = surface;
  context.strokeStyle = edge;
  context.lineWidth = 1;
  context.roundRect(x, y, width, height, 4);
  context.fill();
  context.stroke();

  context.fillStyle = ink;
  context.textBaseline = "middle";
  context.fillText(data.label, x + 8, data.y);
}

export type { Band, NetworkEdge, NetworkPerson, NetworkThread } from "@/lib/scores";
export { BAND_META, BAND_ORDER } from "@/lib/scores";


/**
 * Which tiers are drawn. Additive, because a topic is only meaningful once its
 * threads are on screen.
 */
type Layer = "people" | "threads" | "topics";
const LAYERS: { id: Layer; label: string }[] = [
  { id: "people", label: "People" },
  { id: "threads", label: "+ threads" },
  { id: "topics", label: "+ topics" },
];

/** What the detail panel is showing. */
type Focus =
  | { kind: "person"; person: NetworkPerson }
  | { kind: "thread"; thread: NetworkThread };

/** How many names may be drawn at once, before collision pruning. */
const LABEL_CANDIDATES = 40;
const LABEL_GUTTER = 12;

/**
 * Minimum replies between a pair for the line to be drawn.
 *
 * 444 of the 603 pairs on this corpus answered each other exactly once, and
 * drawing all of them put 204 people in one indistinguishable disc. Two or
 * more is a relationship rather than an interaction — the same distinction
 * Conversation Map draws when it plots reciprocating pairs close together and
 * single responders far apart. Nothing is hidden: the control shows every
 * reply on demand.
 */
const DEFAULT_MIN_REPLIES = 2;

export function ReplyNetwork({
  people,
  edges,
  threads,
  height = 620,
}: {
  people: NetworkPerson[];
  edges: NetworkEdge[];
  threads: NetworkThread[];
  height?: number;
}) {
  const [minReplies, setMinReplies] = useState(DEFAULT_MIN_REPLIES);
  const [filter, setFilter] = useState<FilterId>("all");
  const boxRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const drawn = useRef<Set<string>>(new Set());
  const place = useRef<() => void>(() => {});
  const { resolvedTheme } = useTheme();
  const [unsupported, setUnsupported] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [layer, setLayer] = useState<Layer>("people");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const threadById = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads]);

  const shown = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)!.test;
    const eligible = new Set(people.filter(test).map((p) => p.id));
    const kept = edges.filter(
      (e) => e.replies >= minReplies && eligible.has(e.source) && eligible.has(e.target),
    );
    // Only people the filter leaves connected. A rim of isolated dots is not
    // information the picture is trying to carry — the counts are in the
    // legend, and every account is on the threads page.
    const connected = new Set(kept.flatMap((e) => [e.source, e.target]));
    const visiblePeople = people.filter((p) => connected.has(p.id));
    // Every thread those people are in. Uncapped at the operator's direction:
    // a cap silently answers "what is on this list" with "the top sixty".
    const visibleThreads =
      layer === "people"
        ? []
        : threads.filter((t) => t.participants.some((id) => connected.has(id)));
    const visibleTopics =
      layer === "topics"
        ? [
            ...new Map(
              visibleThreads
                .filter((t) => t.topic_id)
                .map((t) => [t.topic_id!, t.topic_label ?? t.topic_id!]),
            ),
          ].map(([id, label]) => ({ id, label }))
        : [];
    return { edges: kept, people: visiblePeople, threads: visibleThreads, topics: visibleTopics };
  }, [people, edges, threads, minReplies, filter, layer]);

  const focus: Focus | null = useMemo(() => {
    if (!focusKey) return null;
    if (focusKey.startsWith("thread:")) {
      const thread = threadById.get(focusKey.slice("thread:".length));
      return thread ? { kind: "thread", thread } : null;
    }
    const person = byId.get(focusKey);
    return person ? { kind: "person", person } : null;
  }, [focusKey, byId, threadById]);

  // Sigma is constructed once and never torn down. Rebuilding it on every
  // filter change threw "could not find a suitable program for node type
  // circle" on the second construction and took the page down to an error
  // screen — the renderer was relying on shared default program classes
  // surviving a `kill()`. Rebuilding also discarded the camera and re-ran the
  // force pass, so the picture reset every time a chip was pressed.
  useEffect(() => {
    if (!boxRef.current) return;
    try {
      const probe = document.createElement("canvas");
      if (!probe.getContext("webgl2") && !probe.getContext("webgl")) {
        setUnsupported(true);
        return;
      }
    } catch {
      setUnsupported(true);
      return;
    }

    const graph = new Graph({ multi: false, type: "undirected" });
    let renderer: Sigma;
    try {
      renderer = new Sigma(graph, boxRef.current, {
        // Named explicitly rather than inherited: see above.
        nodeProgramClasses: { circle: NodeCircleProgram, square: NodeSquareProgram },
        renderLabels: true,
        labelDensity: 0.3,
        labelGridCellSize: 140,
        labelRenderedSizeThreshold: 5,
        minCameraRatio: 0.05,
        maxCameraRatio: 10,
        stagePadding: 50,
        defaultEdgeColor: cssVar("--thread-line") || "#c3c2bb",
        defaultDrawNodeHover: drawHover,
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      return;
    }
    sigmaRef.current = renderer;
    graphRef.current = graph;
    (window as unknown as { __laocoon?: unknown }).__laocoon = { renderer, graph };

    renderer.on("clickNode", ({ node }) => setFocusKey(node));
    renderer.on("clickStage", () => setFocusKey(null));
    renderer.on("enterNode", ({ node }) => setHovered(node));
    renderer.on("leaveNode", () => setHovered(null));

    const container = renderer.getContainer() as HTMLElement;

    // sigma measures the container once and does not watch it. The review
    // panel adds 19rem of body padding, so the graph was initialising at
    // 1096px, and the moment anything triggered a resize check it jumped 152px
    // — exactly half the 304px the panel occupies. Every position a reader
    // clicked before that jump was measured against the wrong viewport.
    const observer = new ResizeObserver(() => renderer.refresh());
    observer.observe(container);

    let dragging: string | null = null;
    const relative = (event: MouseEvent) => {
      const box = container.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    /**
     * Nearest node under the pointer, computed from display positions.
     *
     * Not sigma's `getNodeAtPosition`: that returns the right node when called
     * cold and null when called from inside a mousedown while a node is
     * hovered, because the hover handler refreshes and reindexes underneath
     * it. A hit test is a distance comparison, so doing it here removes the
     * dependency on when the index was last built.
     */
    const nodeUnder = (point: { x: number; y: number }): string | null => {
      let best: string | null = null;
      let bestDistance = Infinity;
      graph.forEachNode((key) => {
        const display = renderer.getNodeDisplayData(key);
        if (!display) return;
        const at = renderer.framedGraphToViewport(display);
        const radius = renderer.scaleSize
          ? renderer.scaleSize(display.size)
          : (display.size as number);
        const distance = Math.hypot(at.x - point.x, at.y - point.y);
        if (distance <= Math.max(radius, 4) && distance < bestDistance) {
          bestDistance = distance;
          best = key;
        }
      });
      return best;
    };

    const onDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const hit = nodeUnder(relative(event));
      if (!hit) return;
      dragging = hit;
      graph.setNodeAttribute(hit, "highlighted", true);
      renderer.getCamera().disable();
      event.preventDefault();
    };
    const onMove = (event: MouseEvent) => {
      if (!dragging) return;
      const point = renderer.viewportToGraph(relative(event));
      graph.setNodeAttribute(dragging, "x", point.x);
      graph.setNodeAttribute(dragging, "y", point.y);
      event.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      graph.removeNodeAttribute(dragging, "highlighted");
      dragging = null;
      renderer.getCamera().enable();
    };
    // Capture phase, on the document. sigma binds its own `mousemove` and
    // `mouseup` on the document at construction and stops propagation while it
    // is panning, so a listener on window downstream of it never ran — the
    // drag latched on mousedown and then nothing moved.
    container.addEventListener("mousedown", onDown, { capture: true });
    document.addEventListener("mousemove", onMove, { capture: true });
    document.addEventListener("mouseup", onUp, { capture: true });

    return () => {
      observer.disconnect();
      container.removeEventListener("mousedown", onDown, { capture: true });
      document.removeEventListener("mousemove", onMove, { capture: true });
      document.removeEventListener("mouseup", onUp, { capture: true });
      renderer.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, []);

  /** Fill the existing graph. Runs on every filter change; builds nothing. */
  useEffect(() => {
    const graph = graphRef.current;
    const renderer = sigmaRef.current;
    if (!graph || !renderer) return;

    graph.clear();
    const maxMessages = shown.people.reduce((m, p) => Math.max(m, p.messages), 1);
    shown.people.forEach((p, index) => {
      graph.addNode(p.id, {
        label: p.name,
        kind: "person",
        band: p.band,
        type: "circle",
        size: 3 + 17 * Math.sqrt(p.messages / maxMessages),
        weight: p.messages,
        // Seeded on a circle rather than at random, so the force pass starts
        // spread out and converges to the same picture on every load.
        x: Math.cos((index / shown.people.length) * 2 * Math.PI),
        y: Math.sin((index / shown.people.length) * 2 * Math.PI),
      });
    });
    const maxThread = shown.threads.reduce((m, t) => Math.max(m, t.messages), 1);
    shown.threads.forEach((t, index) => {
      graph.addNode(`thread:${t.id}`, {
        label: tidySubject(t.subject),
        kind: "thread",
        // Squares, so a discussion never reads as a person.
        type: "square",
        size: 2 + 10 * Math.sqrt(t.messages / maxThread),
        weight: t.messages,
        x: Math.cos((index / Math.max(1, shown.threads.length)) * 2 * Math.PI) * 1.4,
        y: Math.sin((index / Math.max(1, shown.threads.length)) * 2 * Math.PI) * 1.4,
      });
    });
    shown.topics.forEach((topic, index) => {
      graph.addNode(`topic:${topic.id}`, {
        label: topic.label,
        kind: "topic",
        type: "circle",
        size: 9,
        weight: Number.MAX_SAFE_INTEGER - index,
        x: Math.cos((index / Math.max(1, shown.topics.length)) * 2 * Math.PI) * 2.2,
        y: Math.sin((index / Math.max(1, shown.topics.length)) * 2 * Math.PI) * 2.2,
      });
    });
    for (const e of shown.edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      if (graph.hasEdge(e.source, e.target)) continue;
      graph.addEdge(e.source, e.target, {
        weight: e.replies,
        size: Math.min(3, 0.3 + Math.sqrt(e.replies) * 0.4),
      });
    }
    for (const t of shown.threads) {
      for (const person of t.participants) {
        if (!graph.hasNode(person)) continue;
        if (graph.hasEdge(`thread:${t.id}`, person)) continue;
        graph.addEdge(`thread:${t.id}`, person, { weight: 1, size: 0.4 });
      }
      if (t.topic_id && graph.hasNode(`topic:${t.topic_id}`)) {
        if (!graph.hasEdge(`topic:${t.topic_id}`, `thread:${t.id}`)) {
          graph.addEdge(`topic:${t.topic_id}`, `thread:${t.id}`, { weight: 1, size: 0.6 });
        }
      }
    }

    forceAtlas2.assign(graph, {
      iterations: 400,
      settings: {
        ...forceAtlas2.inferSettings(graph),
        barnesHutOptimize: graph.order > 200,
        gravity: 0.8,
        // Wide, because the point of the picture is the gaps between groups.
        scalingRatio: 40,
        adjustSizes: true,
        outboundAttractionDistribution: true,
      },
    });
    renderer.refresh();
  }, [shown]);

  /** Colour from standing. Re-runs on theme change. */
  useEffect(() => {
    const graph = graphRef.current;
    const renderer = sigmaRef.current;
    if (!graph || !renderer) return;
    const colours = Object.fromEntries(
      BAND_ORDER.map((b) => [b, cssVar(BAND_META[b].token)]),
    ) as Record<Band, string>;
    const threadInk = cssVar("--thread-line") || "#8b8a85";
    const topicInk = cssVar("--warn") || "#8a5a00";
    graph.forEachNode((key, attrs) =>
      graph.setNodeAttribute(
        key,
        "color",
        attrs.kind === "topic"
          ? topicInk
          : attrs.kind === "thread"
            ? threadInk
            : colours[attrs.band as Band],
      ),
    );
    renderer.setSetting("labelColor", { color: cssVar("--cy-ink") || "#1c1917" });
    renderer.setSetting("defaultEdgeColor", cssVar("--thread-line") || "#c3c2bb");
    renderer.refresh();
    place.current();
  }, [resolvedTheme, shown]);

  /** Dim everything outside the selection's neighbourhood. */
  useEffect(() => {
    const renderer = sigmaRef.current;
    const graph = graphRef.current;
    if (!renderer || !graph) return;
    const centre = focusKey ?? hovered;
    const near =
      centre && graph.hasNode(centre) ? new Set([centre, ...graph.neighbors(centre)]) : null;
    // Not "#8882": sigma's WebGL parser does not read four-digit hex with an
    // alpha nibble, and every dimmed node came out olive — which is what made
    // hovering unreadable. rgba() is parsed.
    const dim = "rgba(140,138,132,0.22)";
    renderer.setSetting("nodeReducer", (key, data) => {
      if (near && !near.has(key)) return { ...data, color: dim, label: "" };
      return { ...data, label: drawn.current.has(key) || key === centre ? data.label : "" };
    });
    renderer.setSetting("edgeReducer", (key, data) => {
      if (!near) return data;
      const [s, t] = graph.extremities(key);
      // Kept rather than hidden, faintly: removing them made the neighbourhood
      // float free of the picture it belongs to.
      return near.has(s) && near.has(t) ? data : { ...data, color: dim };
    });
    renderer.refresh({ skipIndexation: true });
  }, [focusKey, hovered, shown]);

  /** Greedy name placement: the busiest accounts first, no two overlapping. */
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer) return;
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return;
    const size = renderer.getSetting("labelSize") ?? 14;
    measure.font = `${size}px ${renderer.getSetting("labelFont") ?? "sans-serif"}`;

    const run = () => {
      const graph = graphRef.current;
      if (!graph) return;
      const { width, height: h } = renderer.getDimensions();
      const candidates = graph
        .nodes()
        .sort(
          (a, b) =>
            (graph.getNodeAttribute(b, "weight") as number) -
            (graph.getNodeAttribute(a, "weight") as number),
        )
        .slice(0, LABEL_CANDIDATES);
      const kept: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const next = new Set<string>();
      for (const key of candidates) {
        const display = renderer.getNodeDisplayData(key);
        if (!display) continue;
        const p = renderer.framedGraphToViewport(display);
        const label = String(graph.getNodeAttribute(key, "label") ?? "");
        const w = measure.measureText(label).width;
        const r = renderer.scaleSize ? renderer.scaleSize(display.size) : display.size;
        const box = { x1: p.x - r - LABEL_GUTTER, y1: p.y - size, x2: p.x + w + LABEL_GUTTER, y2: p.y + size };
        if (box.x2 > width || box.x1 < 0 || box.y1 < 0 || box.y2 > h) continue;
        if (kept.some((k) => box.x1 < k.x2 && k.x1 < box.x2 && box.y1 < k.y2 && k.y1 < box.y2)) continue;
        kept.push(box);
        next.add(key);
      }
      const current = drawn.current;
      if (current.size === next.size && [...next].every((k) => current.has(k))) return;
      drawn.current = next;
      renderer.refresh({ skipIndexation: true });
    };

    place.current = run;
    run();
    const camera = renderer.getCamera();
    camera.on("updated", run);
    return () => {
      camera.off("updated", run);
    };
  }, [shown]);

  const threadsOf = useCallback(
    (personId: string) =>
      threads.filter((t) => t.participants.includes(personId)).sort((a, b) => b.messages - a.messages),
    [threads],
  );

  const reset = useCallback(() => {
    sigmaRef.current?.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration: 320 });
  }, []);

  if (unsupported || failure) {
    return (
      <div
        style={{ height }}
        className="bg-card text-muted-foreground flex w-full flex-col items-center justify-center gap-1 rounded-lg border p-6 text-center text-sm"
      >
        <p className="font-medium">This picture needs WebGL, which this browser did not provide.</p>
        {failure && <p className="text-xs">{failure}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <div ref={boxRef} style={{ height }} className="bg-card w-full rounded-lg border" />
        <button
          type="button"
          onClick={reset}
          className="bg-card/90 text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded-md border px-2 py-1 text-[11px] shadow-sm"
        >
          Reset view
        </button>
        <span className="text-muted-foreground pointer-events-none absolute bottom-2 left-3 text-[11px]">
          Scroll to zoom · drag to pan · click a person
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Filter accounts">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={
                filter === f.id
                  ? "bg-primary text-primary-foreground px-3 py-1.5 text-xs"
                  : "text-muted-foreground hover:bg-accent px-3 py-1.5 text-xs"
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Which replies to draw">
          {[
            { n: 2, label: "Repeated exchanges" },
            { n: 1, label: "Every reply" },
          ].map((o) => (
            <button
              key={o.n}
              onClick={() => setMinReplies(o.n)}
              aria-pressed={minReplies === o.n}
              className={
                minReplies === o.n
                  ? "bg-primary text-primary-foreground px-3 py-1.5 text-xs"
                  : "text-muted-foreground hover:bg-accent px-3 py-1.5 text-xs"
              }
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Which tiers to draw">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              onClick={() => setLayer(l.id)}
              aria-pressed={layer === l.id}
              className={
                layer === l.id
                  ? "bg-primary text-primary-foreground px-3 py-1.5 text-xs"
                  : "text-muted-foreground hover:bg-accent px-3 py-1.5 text-xs"
              }
            >
              {l.label}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground text-xs">
          {shown.people.length} of {people.length} people, {shown.edges.length} pairs
          {minReplies > 1 && " who answered each other more than once"}
          {shown.threads.length > 0 && `, ${shown.threads.length} threads`}
          {shown.topics.length > 0 && `, ${shown.topics.length} topics`}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="text-muted-foreground">Contributor score</span>
        {BAND_ORDER.map((b) => (
          <span key={b} className="flex items-center gap-1.5" title={BAND_META[b].help}>
            <i
              className="inline-block size-3 shrink-0 rounded-full"
              style={{ background: `var(${BAND_META[b].token})` }}
            />
            <span className="text-muted-foreground">{BAND_META[b].label}</span>
            <span className="tnum text-foreground font-medium">
              {shown.people.filter((p) => p.band === b).length}
            </span>
          </span>
        ))}
        <span className="text-muted-foreground ml-auto">
          size is messages sent · a line means one answered the other · drag a node to move it
        </span>
      </div>

      {focus?.kind === "person" && (
        <div className="bg-card mt-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-sm font-semibold">{focus.person.name}</span>
            <span className="tnum text-muted-foreground text-xs">
              contributor score {focus.person.score}/100
            </span>
          </div>
          <p className="text-muted-foreground tnum mt-1 text-xs">
            {focus.person.rfcs} RFC{focus.person.rfcs === 1 ? "" : "s"} ·{" "}
            {focus.person.adopted_drafts} adopted draft
            {focus.person.adopted_drafts === 1 ? "" : "s"}
            {focus.person.chairs_now && " · chairs a working group"}
            {!focus.person.in_datatracker && " · no Datatracker record"}
          </p>
          <p className="text-muted-foreground tnum mt-0.5 text-xs">
            {focus.person.messages} message{focus.person.messages === 1 ? "" : "s"} ·{" "}
            {focus.person.replies_sent} repl{focus.person.replies_sent === 1 ? "y" : "ies"} sent ·{" "}
            {focus.person.replies_received} received · {focus.person.lists.join(", ")}
            {focus.person.first_seen && ` · first posted ${focus.person.first_seen.slice(0, 10)}`}
          </p>
          {(() => {
            // A run-on list of subjects said nothing at a glance. What the
            // operator asked for is which subjects, and how the exchanges in
            // them were carried.
            const own = threadsOf(focus.person.id);
            if (own.length === 0) return null;
            const topics = [
              ...new Map(
                own.filter((t) => t.topic_label).map((t) => [t.topic_id!, t.topic_label!]),
              ).values(),
            ];
            const counts = { high: 0, medium: 0, low: 0 } as Record<Utility, number>;
            for (const t of own) counts[t.utility]++;
            return (
              <div className="mt-2 text-xs">
                <p className="text-muted-foreground">
                  <span className="tnum text-foreground font-medium">{own.length}</span> thread
                  {own.length === 1 ? "" : "s"}
                  {topics.length > 0 && (
                    <>
                      {" across "}
                      <span className="tnum text-foreground font-medium">{topics.length}</span>{" "}
                      topic{topics.length === 1 ? "" : "s"}
                    </>
                  )}
                  {" — "}
                  {UTILITY_ORDER
                    .filter((k) => counts[k] > 0)
                    .map((k) => `${counts[k]} ${UTILITY_META[k].label}`)
                    .join(", ")}
                </p>
                {topics.length > 0 && (
                  <p className="text-muted-foreground mt-1">
                    <span className="text-foreground font-medium">Topics:</span>{" "}
                    {topics.slice(0, 5).join(" · ")}
                    {topics.length > 5 && ` and ${topics.length - 5} more`}
                  </p>
                )}
                <a
                  className="text-primary mt-1 inline-block hover:underline"
                  href={`/people/${focus.person.id}/`}
                >
                  Full profile →
                </a>
              </div>
            );
          })()}
        </div>
      )}

      {focus?.kind === "thread" && (
        <div className="bg-card mt-3 rounded-lg border p-3">
          <a
            href={focus.thread.href}
            target="_blank"
            rel="noreferrer"
            className="hover:text-primary text-sm font-semibold hover:underline"
          >
            {tidySubject(focus.thread.subject)} ↗
          </a>
          <p className="text-muted-foreground tnum mt-1 text-xs">
            {focus.thread.messages} message{focus.thread.messages === 1 ? "" : "s"} ·{" "}
            {focus.thread.participants.length} participant
            {focus.thread.participants.length === 1 ? "" : "s"} ·{" "}
            <span title={UTILITY_META[focus.thread.utility].help}>
              utility {UTILITY_META[focus.thread.utility].label.toLowerCase()}
            </span>
            {" · "}
            {Math.round(focus.thread.top_two_share * 100)}% from the busiest two
            {focus.thread.quiet_for_days !== null &&
              ` · quiet ${focus.thread.quiet_for_days} day${focus.thread.quiet_for_days === 1 ? "" : "s"}`}
          </p>
          {focus.thread.topic_label && (
            <p className="text-muted-foreground mt-0.5 text-xs">
              <span className="text-foreground font-medium">Topic:</span>{" "}
              {focus.thread.topic_label}
            </p>
          )}
          <div className="mt-2">
            <span className="text-foreground text-xs font-medium">Who is in it</span>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {focus.thread.participants
                .map((id) => byId.get(id))
                .filter((p): p is NetworkPerson => Boolean(p))
                .sort((a, b) => b.score - a.score || b.messages - a.messages)
                .map((p) => (
                  <li key={p.id} className="flex items-center gap-1.5 text-xs">
                    <i
                      className="inline-block size-2.5 shrink-0 rounded-full"
                      style={{ background: `var(${BAND_META[p.band].token})` }}
                    />
                    <button
                      type="button"
                      onClick={() => setFocusKey(p.id)}
                      className="hover:text-primary hover:underline"
                    >
                      {p.name}
                    </button>
                    <span className="tnum text-muted-foreground">{p.score}</span>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

    </div>
  );
}
