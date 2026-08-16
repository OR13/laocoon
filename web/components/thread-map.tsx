"use client";

/**
 * The thread map: every discussion at once, coloured by whether the
 * established part of the group turned up.
 *
 * **This replaces a graph the operator called useless, and the diagnosis is
 * worth keeping.** The old one had four faults, all of them design rather than
 * rendering:
 *
 *   1. **It hid its own contents.** Topics were the default view and threads
 *      appeared only on click, so a week's activity was six dots. The reader
 *      had to already know what they were looking for.
 *   2. **It coloured by novelty**, a measure nobody asked for, which does not
 *      predict anything and cannot see the thing being looked for.
 *   3. **It was 560 pixels tall** inside a scrolling page, so it never had
 *      room to show a corpus.
 *   4. **It answered no question.** A picture of topics containing threads is
 *      a restatement of the data model, not a finding.
 *
 * The question this one answers is the operator's, stated plainly: which
 * discussions are on-topic exchanges that serious people engaged with, and
 * which are traffic that nobody with standing ever answered.
 *
 * So the encoding is:
 *
 *   position   the topic a thread belongs to — related discussions sit together
 *   size       messages, so volume is visible
 *   colour     **whether anyone holding community-conferred standing took part**
 *   shape      which list
 *
 * A large, uncoloured node is therefore a busy thread that no established
 * participant joined. That is the shape the operator is looking for, and it is
 * a fact about the reply graph — not a claim about who wrote anything, and not
 * a judgement of any participant. A thread of humans that the chairs happened
 * not to read looks exactly the same, which is why the label says what it
 * measures and nothing more.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { NodeSquareProgram } from "@sigma/node-square";
import { useTheme } from "next-themes";
import { layout, type Placeable } from "@/lib/layout";

const cssVar = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export interface MapThread {
  id: string;
  subject: string;
  list_name: string;
  topic_id: string | null;
  topic_label: string | null;
  messages: number;
  participants: number;
  /** Participants holding community-conferred standing. A count, never a list. */
  with_standing: number;
  /** Share of this thread's replies that came from an account with standing. */
  uptake: number | null;
  last_message_at: string | null;
  href: string;
}

export type Engagement = "none" | "present" | "answering";

/**
 * Three states, from one fact each, in increasing order of involvement.
 *
 * Deliberately not a score. "Nobody with standing is here", "somebody is here"
 * and "somebody is replying" are different situations and a reader can
 * disagree with the boundary between them one column at a time.
 */
export function engagementOf(t: MapThread): Engagement {
  if (t.with_standing === 0) return "none";
  return (t.uptake ?? 0) > 0 ? "answering" : "present";
}

const ENGAGEMENT: Record<Engagement, { label: string; token: string; help: string }> = {
  none: {
    label: "No participant with standing",
    token: "--eng-none",
    help:
      "Nobody holding community-conferred standing took part in this thread. " +
      "That is a fact about who posted, not a judgement of the discussion.",
  },
  present: {
    label: "Present, not replying",
    token: "--eng-present",
    help: "Someone with standing posted in the thread, but none of the replies came from them.",
  },
  answering: {
    label: "Answering",
    token: "--eng-answering",
    help: "Replies in this thread came from accounts holding community-conferred standing.",
  },
};

export const ENGAGEMENT_ORDER: Engagement[] = ["answering", "present", "none"];
export const ENGAGEMENT_META = ENGAGEMENT;

/** Thread marker size in pixels, by message count. */
function markerSize(messages: number, max: number): number {
  return 4 + 22 * Math.sqrt(messages / Math.max(1, max));
}

export function ThreadMap({
  threads,
  onSelect,
  selectedId,
}: {
  threads: MapThread[];
  onSelect: (t: MapThread | null) => void;
  selectedId: string | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const drawnLabels = useRef<Set<string>>(new Set());
  const placeLabels = useRef<() => void>(() => {});
  const { resolvedTheme } = useTheme();
  const [unsupported, setUnsupported] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const byId = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads]);

  /** One anchor per topic, carrying the topic's name. */
  const anchors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of threads) {
      if (!t.topic_id) continue;
      if (!seen.has(t.topic_id)) seen.set(t.topic_id, t.topic_label ?? t.topic_id);
    }
    return seen;
  }, [threads]);

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
    const maxMessages = threads.reduce((m, t) => Math.max(m, t.messages), 1);

    // Topic anchors first: small, neutral, and present only to carry a name and
    // to give the layout a centre. They are not a tier the reader navigates.
    for (const [id, label] of anchors) {
      graph.addNode(`topic:${id}`, {
        label,
        kind: "topic",
        cluster: id,
        size: 3,
        type: "circle",
        x: 0,
        y: 0,
      });
    }
    for (const t of threads) {
      graph.addNode(`thread:${t.id}`, {
        label: t.subject,
        kind: "thread",
        ref: t.id,
        cluster: t.topic_id ?? "unassigned",
        engagement: engagementOf(t),
        // Shape is the list, so the corpus survives greyscale and colour is
        // free to carry the only thing being asked about.
        type: t.list_name === "agentproto" ? "square" : "circle",
        size: markerSize(t.messages, maxMessages),
        x: 0,
        y: 0,
      });
    }

    const placeable: Placeable[] = graph.mapNodes((key, attrs) => ({
      key,
      cluster: String(attrs.cluster),
      tier: attrs.kind === "topic" ? "topic" : "thread",
      weight: Number(attrs.size),
    }));
    const positions = layout(placeable);
    graph.forEachNode((key) => {
      const p = positions.get(key) ?? { x: 0, y: 0 };
      graph.setNodeAttribute(key, "x", p.x);
      graph.setNodeAttribute(key, "y", p.y);
    });

    let renderer: Sigma;
    try {
      renderer = new Sigma(graph, boxRef.current, {
        nodeProgramClasses: { square: NodeSquareProgram },
        renderLabels: true,
        labelDensity: 0.2,
        labelGridCellSize: 200,
        labelRenderedSizeThreshold: 3,
        minCameraRatio: 0.03,
        maxCameraRatio: 12,
        stagePadding: 40,
      });
    } catch {
      setUnsupported(true);
      return;
    }
    sigmaRef.current = renderer;
    graphRef.current = graph;
    (window as unknown as { __laocoon?: unknown }).__laocoon = { renderer, graph };

    renderer.on("clickNode", ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      onSelect(attrs.kind === "thread" ? (byId.get(String(attrs.ref)) ?? null) : null);
    });
    renderer.on("clickStage", () => onSelect(null));
    renderer.on("enterNode", ({ node }) => setHovered(node));
    renderer.on("leaveNode", () => setHovered(null));

    return () => {
      renderer.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [threads, anchors, byId, onSelect]);

  /** Paint from the engagement state. Re-runs on theme change. */
  useEffect(() => {
    const graph = graphRef.current;
    const renderer = sigmaRef.current;
    if (!graph || !renderer) return;
    const colours = Object.fromEntries(
      Object.entries(ENGAGEMENT).map(([k, v]) => [k, cssVar(v.token)]),
    ) as Record<Engagement, string>;
    const topicInk = cssVar("--muted-foreground") || "#8b8a85";
    graph.forEachNode((key, attrs) => {
      graph.setNodeAttribute(
        key,
        "color",
        attrs.kind === "topic" ? topicInk : colours[attrs.engagement as Engagement],
      );
    });
    renderer.setSetting("labelColor", { color: cssVar("--cy-ink") || "#1c1917" });
    renderer.refresh();
    placeLabels.current();
  }, [resolvedTheme, threads]);

  /** Only topic names carry a standing label; a thread names itself on hover. */
  useEffect(() => {
    const renderer = sigmaRef.current;
    const graph = graphRef.current;
    if (!renderer || !graph) return;
    const focus = selectedId ? `thread:${selectedId}` : hovered;
    const neighbours = focus && graph.hasNode(focus) ? new Set([focus]) : null;
    renderer.setSetting("nodeReducer", (key, data) => {
      const named = drawnLabels.current.has(key) || key === focus;
      const dimmed = neighbours && !neighbours.has(key) && graph.getNodeAttribute(key, "cluster") !==
        graph.getNodeAttribute(focus!, "cluster");
      return {
        ...data,
        label: named ? data.label : "",
        ...(dimmed ? { color: "#8883" } : {}),
      };
    });
    renderer.refresh();
  }, [selectedId, hovered, threads]);

  /** Greedy topic-name placement, so no two names ever print over each other. */
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer) return;
    const measure = document.createElement("canvas").getContext("2d");
    if (!measure) return;
    const size = renderer.getSetting("labelSize") ?? 14;
    measure.font = `${size}px ${renderer.getSetting("labelFont") ?? "sans-serif"}`;

    const place = () => {
      const graph = graphRef.current;
      if (!graph) return;
      const { width } = renderer.getDimensions();
      const candidates = graph
        .filterNodes((_k, a) => a.kind === "topic")
        .sort(
          (a, b) =>
            graph.filterNodes((_k, x) => x.cluster === graph.getNodeAttribute(b, "cluster")).length -
            graph.filterNodes((_k, x) => x.cluster === graph.getNodeAttribute(a, "cluster")).length,
        );
      const kept: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const next = new Set<string>();
      for (const key of candidates) {
        const display = renderer.getNodeDisplayData(key);
        if (!display) continue;
        const p = renderer.framedGraphToViewport(display);
        const label = String(graph.getNodeAttribute(key, "label") ?? "");
        const w = measure.measureText(label).width;
        const box = { x1: p.x - 12, y1: p.y - size, x2: p.x + w + 12, y2: p.y + size };
        if (box.x2 > width) continue;
        if (kept.some((k) => box.x1 < k.x2 && k.x1 < box.x2 && box.y1 < k.y2 && k.y1 < box.y2)) {
          continue;
        }
        kept.push(box);
        next.add(key);
      }
      const current = drawnLabels.current;
      if (current.size === next.size && [...next].every((k) => current.has(k))) return;
      drawnLabels.current = next;
      renderer.refresh({ skipIndexation: true });
    };

    placeLabels.current = place;
    place();
    const camera = renderer.getCamera();
    camera.on("updated", place);
    return () => {
      camera.off("updated", place);
    };
  }, [threads]);

  const reset = useCallback(() => {
    sigmaRef.current?.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1, angle: 0 }, { duration: 320 });
  }, []);

  if (unsupported) {
    return (
      <div className="bg-card text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg border p-6 text-center text-sm">
        <p className="font-medium">The map needs WebGL, which this browser did not provide.</p>
        <p className="text-xs">Every figure on the other pages is still correct.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={boxRef} className="bg-card h-full w-full rounded-lg border" />
      <button
        type="button"
        onClick={reset}
        className="bg-card/90 text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded-md border px-2 py-1 text-[11px] shadow-sm"
      >
        Reset view
      </button>
      <span className="text-muted-foreground pointer-events-none absolute bottom-2 left-3 text-[11px]">
        Scroll to zoom · drag to pan · click a thread
      </span>
    </div>
  );
}
