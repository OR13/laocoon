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
import forceAtlas2 from "graphology-layout-forceatlas2";
import { useTheme } from "next-themes";
import type { GraphEdge, GraphNode, GraphView, Tier } from "@/lib/graph-model";

const cssVar = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Sequential ramp position → hex. WebGL needs a concrete colour, not oklch(). */
function rampColour(intensity: number | null, ramp: string[], fallback: string): string {
  if (intensity === null) return fallback;
  return ramp[Math.min(ramp.length - 1, Math.floor(intensity * ramp.length))]!;
}

const TIER_SIZE: Record<Tier, [number, number]> = {
  topic: [10, 30],
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

export function SigmaGraph({ view, height = 560, onSelect, selectedKey }: SigmaGraphProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const { resolvedTheme } = useTheme();
  const [stats, setStats] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const palette = useMemo(
    () => ({
      ramp: ["--seq-100", "--seq-250", "--seq-400", "--seq-550", "--seq-700"],
      thread: "--thread-line",
      ink: "--cy-ink",
      warn: "--cy-warn",
    }),
    [],
  );

  const paint = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const ramp = palette.ramp.map(cssVar);
    const threadColour = cssVar(palette.thread) || "#8b8a85";
    graph.forEachNode((key, attrs) => {
      const tier = attrs.tier as Tier;
      const intensity = (attrs.intensity ?? null) as number | null;
      graph.setNodeAttribute(
        key,
        "color",
        tier === "thread" ? threadColour : rampColour(intensity, ramp, threadColour),
      );
    });
  }, [palette]);

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
    for (const n of view.nodes) {
      maxByTier.set(n.tier, Math.max(maxByTier.get(n.tier) ?? 1, n.weight));
    }
    for (const n of view.nodes) {
      const [min, span] = TIER_SIZE[n.tier];
      graph.addNode(n.key, {
        label: n.label,
        tier: n.tier,
        ref: n.ref,
        intensity: n.intensity,
        standing: n.standing ?? "none",
        cluster: n.cluster,
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
    // Seed each cluster at its own point on a ring before the force pass. A
    // force layout from random positions mixes clusters together and then
    // cannot separate them; seeding gives topics visibly distinct territory,
    // which is the whole reason for clustering in the first place.
    const clusters = [...new Set(view.nodes.map((n) => n.cluster))].sort();
    const ring = new Map(
      clusters.map((c, i) => {
        const angle = (2 * Math.PI * i) / Math.max(1, clusters.length);
        return [c, { x: Math.cos(angle) * 12, y: Math.sin(angle) * 12 }];
      }),
    );
    graph.forEachNode((key, attrs) => {
      const anchor = ring.get(attrs.cluster as string) ?? { x: 0, y: 0 };
      graph.setNodeAttribute(key, "x", anchor.x + (Math.random() - 0.5) * 2.5);
      graph.setNodeAttribute(key, "y", anchor.y + (Math.random() - 0.5) * 2.5);
    });
    if (graph.order > 1) {
      forceAtlas2.assign(graph, {
        iterations: graph.order > 600 ? 120 : 300,
        settings: {
          ...forceAtlas2.inferSettings(graph),
          barnesHutOptimize: graph.order > 300,
          gravity: 0.6,
          scalingRatio: 18,
          adjustSizes: true,
        },
      });
    }
    const layoutMs = Math.round(performance.now() - started);

    graphRef.current = graph;
    try {
      renderer = new Sigma(graph, boxRef.current, {
        // sigma v3 ships only a circle program. Threads render as squares so
        // the tiers survive greyscale, which needs the shape registered.
        nodeProgramClasses: { square: NodeSquareProgram },
      renderLabels: true,
      labelDensity: 0.7,
      labelGridCellSize: 70,
      labelRenderedSizeThreshold: 7,
      defaultEdgeColor: cssVar("--thread-line") || "#c3c2bb",
        minCameraRatio: 0.05,
        maxCameraRatio: 8,
      });
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
      return;
    }
    renderer.setSetting("labelColor", { color: cssVar("--cy-ink") || "#1c1917" });
    sigmaRef.current = renderer;
    paint();
    renderer.refresh();
    setStats(`${graph.order} nodes, ${graph.size} edges · layout ${layoutMs} ms`);

    renderer.on("clickNode", ({ node }) => {
      const found = view.nodes.find((n) => n.key === node) ?? null;
      onSelect?.(found);
    });
    renderer.on("clickStage", () => onSelect?.(null));
    renderer.on("enterNode", ({ node }) => setHovered(node));
    renderer.on("leaveNode", () => setHovered(null));

    return () => {
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
    renderer.setSetting("nodeReducer", (key, data) =>
      neighbours && !neighbours.has(key) ? { ...data, color: "#8882", label: "" } : data,
    );
    renderer.setSetting("edgeReducer", (key, data) => {
      if (!neighbours) return data;
      const [s, t] = graph.extremities(key);
      return neighbours.has(s) && neighbours.has(t) ? data : { ...data, hidden: true };
    });
    renderer.refresh();
  }, [selectedKey, hovered]);

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
