"use client";

/**
 * WebGL graph rendering with sigma.js and graphology.
 *
 * sigma over Cytoscape because the corpus outgrew a 2D canvas: 1,339 messages
 * across two lists today, and the ~20-list neighbourhood in PROBLEM.md §5 puts
 * this well past where a canvas renderer stays interactive. sigma renders in
 * WebGL and hides labels that would collide, which is the behaviour a dense
 * graph needs and the thing a hand-rolled label placer kept getting wrong.
 *
 * WebGL raises the ceiling but does not remove the need for level of detail:
 * 1,233 message nodes on screen at once is unreadable whatever draws them. The
 * graph starts at topics and expands on click.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { NodeSquareProgram } from "@sigma/node-square";
import { animateNodes } from "sigma/utils";
import { useTheme } from "next-themes";
import type { GraphNode, GraphView, Tier } from "@/lib/graph-model";
import { layout } from "@/lib/layout";

const cssVar = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Sequential ramp position → hex. WebGL needs a concrete colour, not oklch(). */
function rampColour(intensity: number | null, ramp: string[], fallback: string): string {
  if (intensity === null) return fallback;
  return ramp[Math.min(ramp.length - 1, Math.floor(intensity * ramp.length))]!;
}

// [minimum, additional span at the heaviest node]. Topics were [10, 30] — a
// 40px radius circle that its own threads were then drawn on top of, because
// the first ring cannot clear a marker that large without pushing the whole
// cluster into its neighbours.
const TIER_SIZE: Record<Tier, [number, number]> = {
  topic: [8, 14],
  thread: [5, 16],
  message: [2, 5],
  person: [4, 16],
};

export interface SigmaGraphProps {
  view: GraphView;
  height?: number;
  onSelect?: (node: GraphNode | null) => void;
  selectedKey?: string | null;
}

/**
 * How many nodes may carry a standing label.
 *
 * A candidate pool, not a guarantee: greedy placement below keeps only the
 * ones whose text boxes clear each other, so a generous pool costs nothing and
 * lets more names through when the layout happens to have room. Everything
 * rejected still names itself on hover.
 */
const MAX_STANDING_LABELS = 30;

export function SigmaGraph({ view, height = 560, onSelect, selectedKey }: SigmaGraphProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  /** Where each node sat last render, so an expand eases instead of jumping. */
  const lastPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const cancelAnimation = useRef<(() => void) | null>(null);
  const { resolvedTheme } = useTheme();
  const [stats, setStats] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // One ramp per list. Hue says which list, position along the ramp says
  // novelty — so the two lists stay distinguishable no matter what else is
  // encoded, and a reader is never left guessing which corpus a node is from.
  const RAMPS: Record<string, string[]> = useMemo(
    () => ({
      agentproto: ["--l1-100", "--l1-300", "--l1-500", "--l1-700"],
      agent2agent: ["--l2-100", "--l2-300", "--l2-500", "--l2-700"],
    }),
    [],
  );
  const palette = useMemo(
    () => ({
      ramp: ["--seq-100", "--seq-250", "--seq-400", "--seq-550", "--seq-700"],
      thread: "--thread-line",
      ink: "--cy-ink",
      warn: "--cy-warn",
    }),
    [],
  );

  /** Topic candidates for a standing label, biggest first. */
  const labelCandidates = useMemo(
    () =>
      view.nodes
        .filter((n) => n.tier === "topic")
        .sort((a, b) => b.weight - a.weight)
        .slice(0, MAX_STANDING_LABELS)
        .map((n) => n.key),
    [view],
  );
  /**
   * The subset actually drawn, chosen in viewport space so none overlap.
   *
   * sigma's own rule keeps one label per grid cell, which does nothing here: a
   * topic name is several cells wide, so neighbouring cells still print over
   * each other. Choosing greedily against measured text boxes is the only way
   * to get a guarantee rather than a tendency.
   */
  const drawnLabels = useRef<Set<string>>(new Set());
  /** Latest greedy-placement pass, so the animation can re-run it on settle. */
  const placeLabels = useRef<() => void>(() => {});

  const paint = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const fallback = palette.ramp.map(cssVar);
    const threadColour = cssVar(palette.thread) || "#8b8a85";
    graph.forEachNode((key, attrs) => {
      const tier = attrs.tier as Tier;
      const intensity = (attrs.intensity ?? null) as number | null;
      const list = attrs.list as string | undefined;
      const ramp = (list && RAMPS[list]?.map(cssVar)) || fallback;
      // No health colouring: the state that drove it inverted against
      // engagement on both lists and was removed. Threads are neutral; the
      // three axes live in the panel where their values are visible.
      graph.setNodeAttribute(
        key,
        "color",
        rampColour(intensity, ramp, tier === "thread" ? threadColour : ramp[1]!),
      );
    });
  }, [palette, RAMPS]);

  useEffect(() => {
    if (!boxRef.current) return;
    // WebGL is not universally available — a headless browser, a locked-down
    // profile, or software rendering that has been disabled. sigma throws on
    // construction in that case, which would take the whole page down. Check
    // first and degrade to a message: a broken graph must not cost the reader
    // the dashboard around it.
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

    const graph = new Graph({ multi: false, type: "mixed" });

    const maxByTier = new Map<Tier, number>();
    const countByTier = new Map<Tier, number>();
    for (const n of view.nodes) {
      maxByTier.set(n.tier, Math.max(maxByTier.get(n.tier) ?? 1, n.weight));
      countByTier.set(n.tier, (countByTier.get(n.tier) ?? 0) + 1);
    }
    for (const n of view.nodes) {
      const [minBase, spanBase] = TIER_SIZE[n.tier];
      // sigma normalises the graph to fit the box, so spreading the layout out
      // buys nothing: widening the spacing by 2x and re-measuring moved node
      // overlaps from 346 to 333. What is fixed in screen pixels is the node
      // *size*, so that is what has to give. 282 threads across 45 packed
      // discs leaves roughly 16px between neighbours — a 21px marker cannot
      // fit in it, and a 10px one can.
      const scale = Math.min(1, Math.sqrt(60 / Math.max(1, countByTier.get(n.tier) ?? 1)));
      const min = minBase * Math.max(0.5, scale);
      const span = spanBase * Math.max(0.35, scale);
      graph.addNode(n.key, {
        // A 35-character topic name is ~250px of text against a ~900px box, so
        // a dozen of them collide wherever the layout puts the nodes. The full
        // name is one click away in the detail panel.
        label: n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label,
        tier: n.tier,
        ref: n.ref,
        intensity: n.intensity,
        standing: n.standing ?? "none",
        cluster: n.cluster,
        list: n.list ?? "",
        gist: n.gist ?? "",
        size: min + span * Math.sqrt(n.weight / (maxByTier.get(n.tier) ?? 1)),
        // Shape carries node type so the tiers survive greyscale.
        type: n.tier === "thread" ? "square" : "circle",
        x: Math.random(),
        y: Math.random(),
      });
    }
    for (const e of view.edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      if (graph.hasEdge(e.source, e.target)) continue;
      graph.addEdge(e.source, e.target, {
        kind: e.kind,
        size: e.kind === "reply" ? 0.6 + Math.sqrt(e.weight) * 0.5 : 0.5,
        color: cssVar("--thread-line") || "#c3c2bb",
      });
    }

    let renderer: Sigma;
    const started = performance.now();
    // Each topic owns a disc, with its threads in rings around it. See
    // lib/layout.ts for why a force layout is the wrong tool for a forest of
    // stars — it put every topic on a rim and every thread in a shared pile.
    const personThreads = new Map<string, string[]>();
    for (const e of view.edges) {
      if (e.kind !== "posted") continue;
      const list = personThreads.get(e.source) ?? [];
      list.push(e.target);
      personThreads.set(e.source, list);
    }
    const placed = layout(view.nodes, personThreads);
    graph.forEachNode((key) => {
      const point = placed.get(key) ?? { x: 0, y: 0 };
      graph.setNodeAttribute(key, "x", point.x);
      graph.setNodeAttribute(key, "y", point.y);
    });
    const layoutMs = Math.round(performance.now() - started);

    // Settle to the computed positions rather than snapping to them. Nodes that
    // were already on screen keep their identity across an expand, which is the
    // difference between "the graph changed" and "a different graph appeared".
    const target = new Map<string, { x: number; y: number }>();
    graph.forEachNode((key, attrs) => {
      target.set(key, { x: attrs.x as number, y: attrs.y as number });
      const previous = lastPositions.current.get(key);
      if (previous) {
        graph.setNodeAttribute(key, "x", previous.x);
        graph.setNodeAttribute(key, "y", previous.y);
      }
    });

    graphRef.current = graph;
    try {
      renderer = new Sigma(graph, boxRef.current, {
        // sigma v3 ships only a circle program. Threads render as squares so
        // the tiers survive greyscale, which needs the shape registered.
        nodeProgramClasses: { square: NodeSquareProgram },
      renderLabels: true,
      // sigma's grid keeps one label per cell, but a 46-character thread
      // subject is far wider than any cell — so 280 threads printed 280
      // overlapping strings and the middle of the graph became unreadable.
      // Only the tier the reader navigates is labelled unconditionally; a
      // thread names itself on hover or selection. See the nodeReducer.
      labelDensity: 0.25,
      labelGridCellSize: 180,
      // Tied to TIER_SIZE: shrinking topic markers to clear their own
      // threads dropped most of them under a threshold of 12, and sigma stopped
      // drawing their names.
      labelRenderedSizeThreshold: 6,
      defaultEdgeColor: cssVar("--thread-line") || "#c3c2bb",
        minCameraRatio: 0.05,
        maxCameraRatio: 8,
        // Labels are drawn to the right of their node, so a graph framed edge
        // to edge clips the rightmost names. Leave a margin for the text.
        stagePadding: 44,
      });
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
      return;
    }
    renderer.setSetting("labelColor", { color: cssVar("--cy-ink") || "#1c1917" });
    sigmaRef.current = renderer;
    // Test hook. sigma draws to WebGL, so a browser-driven check has no DOM to
    // assert against — node positions, overlap and off-screen counts are only
    // reachable through the renderer itself. See web/e2e/graph.spec.ts.
    (window as unknown as { __laocoon?: unknown }).__laocoon = { renderer, graph };
    paint();
    renderer.refresh();
    // Counts help a reader judge what they are looking at; the layout time
    // was developer telemetry on a public page.
    void layoutMs;
    setStats(`${graph.order} nodes, ${graph.size} edges`);

    cancelAnimation.current?.();
    cancelAnimation.current = animateNodes(
      graph,
      Object.fromEntries(target),
      { duration: 520, easing: "quadraticInOut" },
      () => {
        lastPositions.current = target;
        cancelAnimation.current = null;
        // Labels were placed against the pre-animation positions; now that the
        // nodes have arrived, choose again against where they actually are.
        placeLabels.current();
      },
    );

    renderer.on("clickNode", ({ node }) => {
      const found = view.nodes.find((n) => n.key === node) ?? null;
      onSelect?.(found);
    });
    renderer.on("clickStage", () => onSelect?.(null));
    renderer.on("enterNode", ({ node }) => setHovered(node));
    renderer.on("leaveNode", () => setHovered(null));

    return () => {
      cancelAnimation.current?.();
      cancelAnimation.current = null;
      // Keep the last known positions so the next view animates from them.
      graph.forEachNode((key, attrs) => {
        lastPositions.current.set(key, { x: attrs.x as number, y: attrs.y as number });
      });
      renderer.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [view, onSelect, paint]);

  // Dim everything outside the selection's neighbourhood.
  useEffect(() => {
    const renderer = sigmaRef.current;
    const graph = graphRef.current;
    if (!renderer || !graph) return;
    const focus = selectedKey ?? hovered;
    const neighbours = focus && graph.hasNode(focus)
      ? new Set([focus, ...graph.neighbors(focus)])
      : null;
    renderer.setSetting("nodeReducer", (key, data) => {
      if (neighbours && !neighbours.has(key)) return { ...data, color: "#8882", label: "" };
      // Level of detail applies to text as much as to nodes. Topics are the
      // navigation layer and always carry their name; a thread subject is
      // 46 characters and there are hundreds of them, so it appears only when
      // the reader has singled that thread out.
      const named = drawnLabels.current.has(key) || (neighbours ? neighbours.has(key) : false);
      return named ? data : { ...data, label: "" };
    });
    renderer.setSetting("edgeReducer", (key, data) => {
      if (!neighbours) return data;
      const [s, t] = graph.extremities(key);
      return neighbours.has(s) && neighbours.has(t) ? data : { ...data, hidden: true };
    });
    renderer.refresh();
    // `view` is a dependency because a view change destroys the renderer and
    // builds a new one with no reducers set. Without it, expanding a topic
    // brought every suppressed thread label back.
  }, [selectedKey, hovered, view, labelCandidates]);

  // Greedy label placement: walk the candidates biggest-first and keep one only
  // if its measured text box clears every box already kept. Runs after every
  // camera move, because which names fit depends on the zoom.
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
      const kept: { x1: number; y1: number; x2: number; y2: number }[] = [];
      const next = new Set<string>();
      for (const key of labelCandidates) {
        if (!graph.hasNode(key)) continue;
        const display = renderer.getNodeDisplayData(key);
        if (!display) continue;
        const p = renderer.framedGraphToViewport(display);
        const label = String(graph.getNodeAttribute(key, "label") ?? "");
        const w = measure.measureText(label).width;
        const box = { x1: p.x, y1: p.y - size, x2: p.x + w, y2: p.y + size };
        const clashes = kept.some(
          (k) => box.x1 < k.x2 && k.x1 < box.x2 && box.y1 < k.y2 && k.y1 < box.y2,
        );
        if (clashes) continue;
        kept.push(box);
        next.add(key);
      }
      // Only repaint when the set actually changed, or this recurses forever.
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
  }, [view, labelCandidates]);

  useEffect(() => {
    paint();
    sigmaRef.current?.setSetting("labelColor", { color: cssVar("--cy-ink") || "#1c1917" });
    sigmaRef.current?.refresh();
  }, [resolvedTheme, paint]);

  if (unsupported || failed) {
    return (
      <div
        style={{ height }}
        className="bg-card text-muted-foreground flex w-full flex-col items-center justify-center gap-1 rounded-lg border p-6 text-center text-sm"
      >
        <p className="font-medium">The graph needs WebGL, which this browser did not provide.</p>
        <p className="text-xs">
          {failed ?? "Every number on this page is still correct — only the picture is missing."}
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <div ref={boxRef} style={{ height }} className="bg-card w-full rounded-lg border" />
      <span className="text-muted-foreground pointer-events-none absolute right-2 bottom-2 text-[11px]">
        {stats}
      </span>
    </div>
  );
}
