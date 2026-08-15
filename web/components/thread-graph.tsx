"use client";

/**
 * The publishable graph: threads as nodes, an edge wherever two threads share
 * participants, weighted by how many.
 *
 * No account appears — only counts of them — which is what lets a graph go on a
 * public page at all. PROBLEM.md §4 rejects co-participation edges *between
 * people*, because they make everyone in a busy thread look connected. Between
 * *threads* the same construction is the point: it says which discussions the
 * same people are moving between.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core, type NodeSingular } from "cytoscape";
import fcose from "cytoscape-fcose";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useTimeRange } from "@/components/time-range";
import type { Activity, ThreadNode } from "@/lib/data";

cytoscape.use(fcose as never);

const cssVar = (n: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function buildStyle(): cytoscape.StylesheetJson {
  const ink = cssVar("--cy-ink") || "#1c1917";
  const halo = cssVar("--cy-halo") || "#ffffff";
  const line = cssVar("--thread-line") || "#8b8a85";
  const warn = cssVar("--cy-warn") || "#8a5a00";
  return [
    {
      selector: "node",
      style: {
        shape: "round-rectangle",
        "background-color": "data(fill)",
        "border-color": line,
        "border-width": "data(bw)",
        width: "data(sz)",
        height: "data(hh)",
        label: "data(label)",
        "font-size": 10,
        color: ink,
        "text-outline-color": halo,
        "text-outline-width": 2.5,
        "text-valign": "bottom",
        "text-margin-y": 3,
        "text-wrap": "ellipsis",
        "text-max-width": "170px",
        "min-zoomed-font-size": 8,
      },
    },
    {
      selector: "edge",
      style: {
        width: "data(w)",
        "line-color": line,
        opacity: 0.4,
        "curve-style": "straight",
      },
    },
    { selector: ".dim", style: { opacity: 0.08, "text-opacity": 0 } },
    { selector: ".pick", style: { "border-color": warn, "border-width": 4, "z-index": 99 } },
  ] as cytoscape.StylesheetJson;
}

export function ThreadGraph({ activity }: { activity: Activity }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const { resolvedTheme } = useTheme();
  const { days } = useTimeRange();
  const [selected, setSelected] = useState<ThreadNode | null>(null);
  const [stats, setStats] = useState("");

  const cutoff = useMemo(() => {
    if (days <= 0 || activity.daily.length === 0) return null;
    const last = activity.daily[activity.daily.length - 1]!.day;
    const d = new Date(`${last}T23:59:59Z`);
    d.setUTCDate(d.getUTCDate() - days + 1);
    return d.toISOString();
  }, [activity.daily, days]);

  const byId = useMemo(
    () => new Map(activity.thread_graph.nodes.map((n) => [n.id, n])),
    [activity.thread_graph.nodes],
  );

  const runLayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const started = performance.now();
    const layout = cy.layout({
      name: "fcose", quality: "proof", animate: false, randomize: true,
      nodeSeparation: 130, nodeRepulsion: 9000, gravity: 0.22,
      idealEdgeLength: 120, packComponents: true, tile: true, padding: 24,
    } as never);
    layout.one("layoutstop", () => {
      cy.fit(undefined, 24);
      setStats(
        `${cy.nodes(":visible").length} threads, ${cy.edges(":visible").length} links · layout ${Math.round(performance.now() - started)} ms`,
      );
    });
    layout.run();
  }, []);

  useEffect(() => {
    if (!boxRef.current) return;
    const ramp = ["--seq-100", "--seq-250", "--seq-400", "--seq-550", "--seq-700"].map(cssVar);
    const nodes = activity.thread_graph.nodes;
    const maxMsg = Math.max(1, ...nodes.map((n) => n.message_count));
    const maxShared = Math.max(1, ...activity.thread_graph.edges.map((e) => e.shared_participants));
    // Fill by how many participants held standing — the publishable analogue of
    // the private view's reputation ramp.
    const maxStanding = Math.max(1, ...nodes.map((n) => n.with_standing));

    const cy = cytoscape({
      container: boxRef.current,
      wheelSensitivity: 0.2,
      elements: [
        ...nodes.map((n) => ({
          data: {
            id: n.id, label: n.subject.replace(/^\[[^\]]+\]\s*/, "").slice(0, 44),
            sz: 26 + 90 * Math.sqrt(n.message_count / maxMsg),
            hh: 16 + 22 * Math.sqrt(n.message_count / maxMsg),
            bw: n.with_standing > 0 ? 2.5 : 1,
            fill: ramp[Math.min(ramp.length - 1, Math.round((n.with_standing / maxStanding) * (ramp.length - 1)))],
          },
        })),
        ...activity.thread_graph.edges.map((e, i) => ({
          data: {
            id: `e${i}`, source: e.source, target: e.target,
            w: 0.8 + 3.2 * (e.shared_participants / maxShared),
          },
        })),
      ],
      style: buildStyle(),
    });

    cy.on("tap", "node", (evt) => {
      const node = evt.target as NodeSingular;
      cy.elements().removeClass("pick dim");
      cy.elements().difference(node.closedNeighborhood()).addClass("dim");
      node.addClass("pick");
      setSelected(byId.get(node.id()) ?? null);
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass("pick dim");
        setSelected(null);
      }
    });

    cyRef.current = cy;
    return () => { cy.destroy(); cyRef.current = null; };
  }, [activity.thread_graph, byId]);

  useEffect(() => { cyRef.current?.style(buildStyle()); }, [resolvedTheme]);

  // The lookback window filters the graph too, so the picture matches the tiles.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().style("display", "element");
      if (cutoff) {
        cy.nodes().forEach((n) => {
          const t = byId.get(n.id());
          if (t && (t.last_message_at ?? "") < cutoff) n.style("display", "none");
        });
      }
    });
    runLayout();
  }, [cutoff, byId, runLayout]);

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
      <div className="relative">
        <div ref={boxRef} className="bg-card h-[420px] rounded-lg border" role="application"
             aria-label="Thread co-participation graph" />
        <div className="text-muted-foreground absolute right-2 bottom-2 flex items-center gap-2 text-[11px]">
          <span>{stats}</span>
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={runLayout}>
            Re-run
          </Button>
        </div>
      </div>
      <aside className="bg-card rounded-lg border p-3 text-sm">
        {!selected ? (
          <p className="text-muted-foreground text-xs">
            Each box is a thread; a link means the same people posted in both. Size is
            messages, fill is how many participants held community-conferred standing.
            Click one for its numbers.
          </p>
        ) : (
          <div>
            <h3 className="text-sm leading-snug font-semibold">{selected.subject}</h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Messages</dt><dd className="tnum m-0">{selected.message_count}</dd>
              <dt className="text-muted-foreground">Participants</dt><dd className="tnum m-0">{selected.distinct_senders}</dd>
              <dt className="text-muted-foreground">With standing</dt><dd className="tnum m-0">{selected.with_standing}</dd>
              <dt className="text-muted-foreground">Max depth</dt><dd className="tnum m-0">{selected.max_depth}</dd>
              <dt className="text-muted-foreground">Started</dt><dd className="tnum m-0">{selected.started_at?.slice(0, 10) ?? "—"}</dd>
              <dt className="text-muted-foreground">Last message</dt><dd className="tnum m-0">{selected.last_message_at?.slice(0, 10) ?? "—"}</dd>
            </dl>
            <p className="text-muted-foreground mt-3 text-[11px]">
              No participant is named here. &ldquo;With standing&rdquo; is a count under the
              published seed rule, not a judgement of anyone&apos;s contribution.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
