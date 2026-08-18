"use client";

/**
 * The whole space in one picture: people, threads and topics.
 *
 * **Everything is drawn at once.** Tier pickers and caps kept answering "what
 * is on this list" with "some of it", and the operator asked for all of it —
 * every person, every thread, every topic, every reply. What used to be a
 * visibility control is now a *filter*: pick specific people, threads or
 * topics and the picture narrows to them and what they touch.
 *
 * **Shape is the kind of thing, colour is the score.** Circles are people,
 * squares are threads, diamonds are topics. A person's colour is their
 * Laocoön contributor score and a thread's is its Laocoön utility score, on
 * the same three levels and the same palette, so a reader learns it once.
 * Topics carry no colour: they are containers, and colouring one would imply a
 * judgement of a subject.
 *
 * **Selection has to show the subgraph.** Dimming everything else made the
 * selection legible and its *connections* invisible, which is backwards — the
 * point of clicking a node is to see what it is attached to. Selecting now
 * lifts the neighbourhood: its nodes keep full colour and gain labels, its
 * edges thicken and take the accent, and everything else falls to a wash that
 * is still there for context.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { EdgeRectangleProgram, NodeCircleProgram } from "sigma/rendering";
import { useTheme } from "next-themes";
import { Pick, type PickOption } from "@/components/pick";
import { drawThemedHover, NodeDiamondProgram, ThemedSquareProgram } from "@/lib/node-shapes";
import { tidySubject } from "@/lib/graph-model";
import {
  contributorLevel, CONTRIBUTOR_HELP, LEVEL_META, LEVELS, UTILITY_HELP,
  type Level, type NetworkEdge, type NetworkPerson, type NetworkThread, type NetworkTopic,
} from "@/lib/scores";
import { withBase } from "@/lib/base";

const cssVar = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export type Kind = "person" | "thread" | "topic";
export const KIND_SHAPE: Record<Kind, string> = {
  person: "circle",
  thread: "square",
  topic: "diamond",
};

/**
 * A reproducible scatter, from the node's own key.
 *
 * Seeding the three tiers on three concentric circles produced a picture that
 * stayed three concentric circles: a force layout cannot break a symmetry that
 * perfect, so 639 nodes came out as a spiral rather than as clusters. Hashing
 * the key gives every node its own starting point, breaks the symmetry, and is
 * still identical on every reload — which `Math.random` would not be.
 */
function seedPoint(key: string): { x: number; y: number } {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const a = ((hash >>> 0) % 10_000) / 10_000;
  const b = ((Math.imul(hash, 48271) >>> 0) % 10_000) / 10_000;
  const angle = a * 2 * Math.PI;
  // sqrt so the disc fills evenly instead of bunching at the centre.
  const radius = Math.sqrt(b) * 10;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/** How many names may be drawn at once, before collision pruning. */
const LABEL_CANDIDATES = 40;
const LABEL_GUTTER = 12;

export function ReplyNetwork({
  people,
  edges,
  threads,
  topics,
  height = 660,
}: {
  people: NetworkPerson[];
  edges: NetworkEdge[];
  threads: NetworkThread[];
  topics: NetworkTopic[];
  height?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const drawn = useRef<Set<string>>(new Set());
  const place = useRef<() => void>(() => {});
  const { resolvedTheme } = useTheme();
  const [unsupported, setUnsupported] = useState(false);
  const [laying, setLaying] = useState(true);
  const [levels, setLevels] = useState<Level[]>([...LEVELS]);
  const [pickedPeople, setPickedPeople] = useState<string[]>([]);
  const [pickedThreads, setPickedThreads] = useState<string[]>([]);
  const [pickedTopics, setPickedTopics] = useState<string[]>([]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const threadById = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads]);
  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);

  const shown = useMemo(() => {
    let keepPeople = new Set(
      people.filter((p) => levels.includes(contributorLevel(p.score))).map((p) => p.id),
    );
    let keepThreads = new Set(threads.map((t) => t.id));
    let keepTopics = new Set(topics.map((t) => t.id));

    // A pick narrows the picture to what was picked and what it touches. With
    // nothing picked everything stays, which is the operator's default.
    const narrowed = pickedPeople.length + pickedThreads.length + pickedTopics.length > 0;
    if (narrowed) {
      const threadSeed = new Set<string>([
        ...pickedThreads,
        ...topics.filter((t) => pickedTopics.includes(t.id)).flatMap((t) => t.threads),
        ...threads
          .filter((t) => t.participants.some((p) => pickedPeople.includes(p)))
          .map((t) => t.id),
      ]);
      const peopleSeed = new Set<string>([
        ...pickedPeople,
        ...threads.filter((t) => threadSeed.has(t.id)).flatMap((t) => t.participants),
      ]);
      keepThreads = threadSeed;
      keepPeople = new Set([...peopleSeed].filter((id) => keepPeople.has(id)));
      keepTopics = new Set(
        threads.filter((t) => threadSeed.has(t.id) && t.topic_id).map((t) => t.topic_id!),
      );
    }

    return {
      people: people.filter((p) => keepPeople.has(p.id)),
      threads: threads.filter((t) => keepThreads.has(t.id)),
      topics: topics.filter((t) => keepTopics.has(t.id)),
      edges: edges.filter((e) => keepPeople.has(e.source) && keepPeople.has(e.target)),
      narrowed,
    };
  }, [people, edges, threads, topics, levels, pickedPeople, pickedThreads, pickedTopics]);

  /** Build once. Rebuilding tripped sigma's shared node-program registry. */
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
        nodeProgramClasses: {
          circle: NodeCircleProgram,
          square: ThemedSquareProgram,
          diamond: NodeDiamondProgram,
        },
        // sigma had only `line` and `arrow` registered, and `line` draws a
        // 1px GL line that ignores `size` — 1,616 edges reported themselves as
        // visible and not one of them was. The rectangle program honours
        // thickness, which is what makes a selected subgraph stand out.
        edgeProgramClasses: { rectangle: EdgeRectangleProgram },
        defaultEdgeType: "rectangle",
        renderLabels: true,
        labelDensity: 0.3,
        labelGridCellSize: 140,
        labelRenderedSizeThreshold: 6,
        minCameraRatio: 0.03,
        maxCameraRatio: 12,
        stagePadding: 50,
        defaultDrawNodeHover: drawThemedHover,
      });
    } catch {
      setUnsupported(true);
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
    // sigma measures the container once and never watches it.
    const observer = new ResizeObserver(() => renderer.refresh());
    observer.observe(container);

    let dragging: string | null = null;
    const relative = (event: MouseEvent) => {
      const box = container.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    /** Own hit test: sigma's returns null when called from inside a mousedown. */
    const nodeUnder = (point: { x: number; y: number }): string | null => {
      let best: string | null = null;
      let bestDistance = Infinity;
      graph.forEachNode((key) => {
        const display = renderer.getNodeDisplayData(key);
        if (!display) return;
        const at = renderer.framedGraphToViewport(display);
        const radius = renderer.scaleSize ? renderer.scaleSize(display.size) : display.size;
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
    // Capture phase on the document: sigma stops propagation while panning.
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

  /** Fill the graph. Runs on every filter change and builds nothing. */
  useEffect(() => {
    const graph = graphRef.current;
    const renderer = sigmaRef.current;
    if (!graph || !renderer) return;
    // 600 force iterations over 639 nodes blocks the main thread for a couple
    // of seconds. Yielding one frame first lets the spinner actually paint —
    // without it the flag flips to true and back inside the same frame and the
    // reader sees a frozen page instead.
    setLaying(true);
    const frame = requestAnimationFrame(() => {
    graph.clear();

    const maxMessages = shown.people.reduce((m, p) => Math.max(m, p.messages), 1);
    shown.people.forEach((p) => {
      graph.addNode(p.id, {
        label: p.name,
        kind: "person" as Kind,
        level: contributorLevel(p.score),
        type: KIND_SHAPE.person,
        size: 3 + 14 * Math.sqrt(p.messages / maxMessages),
        weight: p.messages,
        ...seedPoint(p.id),
      });
    });
    const maxThread = shown.threads.reduce((m, t) => Math.max(m, t.messages), 1);
    shown.threads.forEach((t) => {
      graph.addNode(`thread:${t.id}`, {
        label: tidySubject(t.subject),
        kind: "thread" as Kind,
        level: t.utility,
        type: KIND_SHAPE.thread,
        size: 2.5 + 9 * Math.sqrt(t.messages / maxThread),
        weight: t.messages,
        ...seedPoint(t.id),
      });
    });
    shown.topics.forEach((topic, i) => {
      graph.addNode(`topic:${topic.id}`, {
        label: topic.label,
        kind: "topic" as Kind,
        type: KIND_SHAPE.topic,
        size: 10,
        weight: Number.MAX_SAFE_INTEGER - i,
        ...seedPoint(topic.id),
      });
    });

    for (const e of shown.edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      if (graph.hasEdge(e.source, e.target)) continue;
      graph.addEdge(e.source, e.target, { kind: "reply", size: 1 });
    }
    for (const t of shown.threads) {
      for (const person of t.participants) {
        if (!graph.hasNode(person) || graph.hasEdge(`thread:${t.id}`, person)) continue;
        graph.addEdge(`thread:${t.id}`, person, { kind: "posted", size: 0.7 });
      }
      if (t.topic_id && graph.hasNode(`topic:${t.topic_id}`)) {
        if (!graph.hasEdge(`topic:${t.topic_id}`, `thread:${t.id}`)) {
          graph.addEdge(`topic:${t.topic_id}`, `thread:${t.id}`, { kind: "contains", size: 0.7 });
        }
      }
    }

    // Barnes-Hut makes the iteration count affordable; 180 left the seed
    // scatter barely disturbed and the clusters unformed.
    forceAtlas2.assign(graph, {
      iterations: 600,
      settings: {
        ...forceAtlas2.inferSettings(graph),
        barnesHutOptimize: true,
        gravity: 1.2,
        scalingRatio: 18,
        adjustSizes: true,
        outboundAttractionDistribution: true,
      },
    });
    renderer.refresh();
    place.current();
      setLaying(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [shown]);

  /** Colour, and the wash everything outside a selection falls to. */
  useEffect(() => {
    const graph = graphRef.current;
    const renderer = sigmaRef.current;
    if (!graph || !renderer) return;

    const level = Object.fromEntries(
      LEVELS.map((l) => [l, cssVar(LEVEL_META[l].token)]),
    ) as Record<Level, string>;
    // A hex, not --muted-foreground: that token is oklch(), which sigma's
    // WebGL path cannot parse and silently renders black. Every topic diamond
    // came out solid black. Same failure as the four-digit hex before it.
    const topicInk = cssVar("--thread-line") || "#8b8a85";
    graph.forEachNode((key, attrs) =>
      graph.setNodeAttribute(
        key,
        "color",
        attrs.kind === "topic" ? topicInk : level[attrs.level as Level],
      ),
    );

    const centre = focusKey ?? hovered;
    const near =
      centre && graph.hasNode(centre) ? new Set([centre, ...graph.neighbors(centre)]) : null;

    // Edges were what made the picture unreadable. At rest they are a thin
    // wash; inside a selection they take the accent and thicken, so the
    // subgraph is what stands out rather than what merely survives.
    // Opaque, theme-aware, and close to the surface. sigma parses rgba() but
    // does not alpha-blend it, so a translucent grey rendered at full strength:
    // invisible on white, and a mass of bright lines on the dark surface.
    // 1,616 edges are context; the selection is what has to carry structure.
    const restEdge = cssVar("--edge-rest") || "#e7e5e0";
    const restNode = cssVar("--node-rest") || "#dcdad4";
    const accent = cssVar("--cy-primary") || "#2a78d6";

    renderer.setSetting("nodeReducer", (key, data) => {
      if (near && !near.has(key)) return { ...data, color: restNode, label: "" };
      const named = drawn.current.has(key) || key === centre || Boolean(near);
      return { ...data, label: named ? data.label : "", zIndex: near ? 1 : 0 };
    });
    renderer.setSetting("edgeReducer", (key, data) => {
      const [s, t] = graph.extremities(key);
      if (!near) return { ...data, color: restEdge };
      return near.has(s) && near.has(t)
        ? { ...data, color: accent, size: Math.max(2.2, (data.size as number) * 3), zIndex: 1 }
        : { ...data, color: restEdge, size: 0.3 };
    });
    renderer.setSetting("labelColor", { color: cssVar("--cy-ink") || "#1c1917" });
    renderer.refresh({ skipIndexation: true });
  }, [resolvedTheme, shown, focusKey, hovered]);

  /** Greedy label placement, so no two names ever print over each other. */
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
        const box = {
          x1: p.x - r - LABEL_GUTTER,
          y1: p.y - size,
          x2: p.x + w + LABEL_GUTTER,
          y2: p.y + size,
        };
        if (box.x2 > width || box.x1 < 0 || box.y1 < 0 || box.y2 > h) continue;
        if (kept.some((k) => box.x1 < k.x2 && k.x1 < box.x2 && box.y1 < k.y2 && k.y1 < box.y2)) {
          continue;
        }
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

  const reset = useCallback(() => {
    sigmaRef.current?.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration: 320 });
  }, []);

  /** What the selection is, and what it is attached to. */
  const detail = useMemo(() => {
    if (!focusKey) return null;
    const graph = graphRef.current;
    const neighbours = graph?.hasNode(focusKey) ? graph.neighbors(focusKey) : [];
    const counts = { person: 0, thread: 0, topic: 0 };
    for (const key of neighbours) {
      const kind = graph!.getNodeAttribute(key, "kind") as Kind;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    if (focusKey.startsWith("thread:")) {
      const thread = threadById.get(focusKey.slice(7));
      return thread ? ({ kind: "thread", thread, counts } as const) : null;
    }
    if (focusKey.startsWith("topic:")) {
      const topic = topicById.get(focusKey.slice(6));
      return topic ? ({ kind: "topic", topic, counts } as const) : null;
    }
    const person = personById.get(focusKey);
    return person ? ({ kind: "person", person, counts } as const) : null;
  }, [focusKey, personById, threadById, topicById]);

  const peopleOptions: PickOption[] = useMemo(
    () =>
      people.map((p) => ({
        id: p.id,
        label: p.name,
        hint: `contributor ${p.score} · ${p.messages} messages`,
      })),
    [people],
  );
  const threadOptions: PickOption[] = useMemo(
    () =>
      threads.map((t) => ({
        id: t.id,
        label: tidySubject(t.subject),
        hint: `${t.messages} messages · utility ${t.utility}`,
      })),
    [threads],
  );
  const topicOptions: PickOption[] = useMemo(
    () => topics.map((t) => ({ id: t.id, label: t.label, hint: `${t.messages} messages` })),
    [topics],
  );

  if (unsupported) {
    return (
      <div
        style={{ height }}
        className="bg-card text-muted-foreground flex w-full items-center justify-center rounded-lg border text-sm"
      >
        This picture needs WebGL, which this browser did not provide.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Show contributor score</span>
          <div
            className="flex overflow-hidden rounded-md border"
            role="group"
            aria-label="Contributor score"
          >
            {LEVELS.map((l) => (
              <button
                key={l}
                aria-pressed={levels.includes(l)}
                title={CONTRIBUTOR_HELP[l]}
                onClick={() =>
                  setLevels((current) =>
                    current.includes(l) ? current.filter((x) => x !== l) : [...current, l],
                  )
                }
                className={
                  levels.includes(l)
                    ? "px-3 py-1.5 text-xs text-white"
                    : "text-muted-foreground hover:bg-accent px-3 py-1.5 text-xs"
                }
                style={levels.includes(l) ? { background: `var(${LEVEL_META[l].token})` } : undefined}
              >
                {LEVEL_META[l].label}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground ml-auto text-xs">
            {shown.people.length} people · {shown.threads.length} threads · {shown.topics.length}{" "}
            topics{shown.narrowed && " · filtered"}
          </span>
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          <Pick
            label="People"
            placeholder="Find a person…"
            options={peopleOptions}
            selected={pickedPeople}
            onChange={setPickedPeople}
          />
          <Pick
            label="Threads"
            placeholder="Find a thread…"
            options={threadOptions}
            selected={pickedThreads}
            onChange={setPickedThreads}
          />
          <Pick
            label="Topics"
            placeholder="Find a topic…"
            options={topicOptions}
            selected={pickedTopics}
            onChange={setPickedTopics}
          />
        </div>
      </div>

      <div className="relative">
        <div ref={boxRef} style={{ height }} className="bg-card w-full rounded-lg border" />
        {laying && (
          <div className="bg-card/80 absolute inset-0 flex items-center justify-center rounded-lg">
            <span className="text-muted-foreground flex items-center gap-2 text-sm">
              <i
                aria-hidden
                className="border-muted-foreground/30 border-t-primary inline-block size-4 animate-spin rounded-full border-2"
              />
              Laying out {shown.people.length + shown.threads.length + shown.topics.length} nodes…
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={reset}
          className="bg-card/90 text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded-md border px-2 py-1 text-[11px] shadow-sm"
        >
          Reset view
        </button>
        <span className="text-muted-foreground pointer-events-none absolute bottom-2 left-3 text-[11px]">
          Scroll to zoom · drag to pan · drag a node to move it · click for detail
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5">
          <i className="bg-muted-foreground inline-block size-2.5 rounded-full" /> person
        </span>
        <span className="flex items-center gap-1.5">
          <i className="bg-muted-foreground inline-block size-2.5 rounded-[2px]" /> thread
        </span>
        <span className="flex items-center gap-1.5">
          <i className="bg-muted-foreground inline-block size-2.5 rotate-45 rounded-[1px]" /> topic
        </span>
        <span className="text-muted-foreground ml-auto">
          colour is the score, size is messages
        </span>
      </div>

      {detail && (
        <div className="bg-card mt-3 rounded-lg border p-3">
          {detail.kind === "person" && (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <a
                  className="hover:text-primary text-sm font-semibold hover:underline"
                  href={withBase(`/people/${detail.person.id}/`)}
                >
                  {detail.person.name}
                </a>
                <span
                  className="tnum text-xs"
                  style={{
                    color: `var(${LEVEL_META[contributorLevel(detail.person.score)].token})`,
                  }}
                  title={CONTRIBUTOR_HELP[contributorLevel(detail.person.score)]}
                >
                  contributor{" "}
                  {LEVEL_META[contributorLevel(detail.person.score)].label.toLowerCase()} ·{" "}
                  {detail.person.score}/100
                </span>
              </div>
              <p className="text-muted-foreground tnum mt-1 text-xs">
                {detail.person.rfcs} RFC{detail.person.rfcs === 1 ? "" : "s"} ·{" "}
                {detail.person.adopted_drafts} adopted draft
                {detail.person.adopted_drafts === 1 ? "" : "s"}
                {detail.person.chairs_now && " · chairs a working group"} ·{" "}
                {detail.person.messages} message{detail.person.messages === 1 ? "" : "s"}
              </p>
            </>
          )}
          {detail.kind === "thread" && (
            <>
              <a
                href={detail.thread.href}
                target="_blank"
                rel="noreferrer"
                className="hover:text-primary text-sm font-semibold hover:underline"
              >
                {tidySubject(detail.thread.subject)} ↗
              </a>
              <p className="text-muted-foreground tnum mt-1 text-xs">
                <span
                  style={{ color: `var(${LEVEL_META[detail.thread.utility].token})` }}
                  title={UTILITY_HELP[detail.thread.utility]}
                >
                  utility {LEVEL_META[detail.thread.utility].label.toLowerCase()}
                </span>{" "}
                · {detail.thread.messages} messages · {detail.thread.participants.length}{" "}
                participants · {Math.round(detail.thread.top_two_share * 100)}% from the busiest
                two
                {detail.thread.quiet_for_days !== null &&
                  ` · quiet ${detail.thread.quiet_for_days}d`}
              </p>
              {detail.thread.topic_label && detail.thread.topic_id && (
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Topic:{" "}
                  <a
                    className="text-primary hover:underline"
                    href={withBase(`/topics/${detail.thread.topic_id}/`)}
                  >
                    {detail.thread.topic_label}
                  </a>
                </p>
              )}
            </>
          )}
          {detail.kind === "topic" && (
            <>
              <a
                className="hover:text-primary text-sm font-semibold hover:underline"
                href={withBase(`/topics/${detail.topic.id}/`)}
              >
                {detail.topic.label}
              </a>
              <p className="text-muted-foreground tnum mt-1 text-xs">
                {detail.topic.threads.length} threads · {detail.topic.messages} messages ·{" "}
                {detail.topic.participants.length} people ·{" "}
                {LEVELS.filter((l) => detail.topic.utility[l] > 0)
                  .map((l) => `${detail.topic.utility[l]} ${LEVEL_META[l].label.toLowerCase()}`)
                  .join(", ")}{" "}
                by utility
              </p>
            </>
          )}
          <p className="text-muted-foreground mt-1.5 text-xs">
            <span className="text-foreground font-medium">Connected to</span>{" "}
            {[
              detail.counts.person > 0 && `${detail.counts.person} people`,
              detail.counts.thread > 0 && `${detail.counts.thread} threads`,
              detail.counts.topic > 0 && `${detail.counts.topic} topics`,
            ]
              .filter(Boolean)
              .join(" · ") || "nothing in the current filter"}
            .
          </p>
        </div>
      )}
    </div>
  );
}
