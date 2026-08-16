/**
 * Deterministic layout for the topic → thread graph.
 *
 * **Why not a force layout.** forceAtlas2 was used here and it produced a ring
 * of topics with every thread piled in the middle: a thread ended up nowhere
 * near the topic that contains it, which is the one relationship the picture
 * exists to show. That is not a tuning failure. This graph is a *forest of
 * stars* — each topic connects only to its own threads, and there are no
 * topic-to-topic edges at all — so a force layout has no cross-cluster
 * information to work with. Its attraction term pulls every star toward the
 * barycentre and its repulsion term, with `adjustSizes` on, pushes the largest
 * nodes (the topics) outward. A ring of topics around a mass of threads is
 * exactly what those two forces produce, and no parameter fixes it.
 *
 * Containment has a layout that reads at a glance instead: put each topic at
 * the centre of its own disc and its threads around it. Clusters cannot
 * interleave because their discs are packed without overlapping, so "which
 * threads belong to this topic" is answered by proximity and never by tracing
 * an edge.
 *
 * The result is also **stable**: the same input gives the same positions, so
 * expanding one topic does not rearrange the rest of the picture. A force
 * layout reseeded from a new random state on every expansion, which is what
 * made the graph feel like it was being replaced rather than opened.
 */

export interface Placeable {
  key: string;
  /** The topic this belongs to. A topic's own cluster is itself. */
  cluster: string;
  tier: string;
  weight: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Threads sit this far apart, in the same units as the returned positions.
 *
 * These are tuned against rendered pixels, not against each other. sigma keeps
 * node size roughly constant as the camera zooms out, so a graph that grows
 * wider does *not* get more forgiving — spacing that reads at five clusters
 * turns into a solid mass at forty-five. The Playwright overlap check is what
 * these are set against.
 */
const THREAD_SPACING = 5.5;
/** Gap between one topic's disc and the next. */
const CLUSTER_PADDING = 6.0;
/** A topic with no threads still needs room for its own marker. */
const MIN_CLUSTER_RADIUS = 5.0;
/**
 * At or below this many clusters, centres go on a grid instead of a spiral.
 *
 * A spiral of six clusters is a tall narrow arc — the first turn has not
 * closed yet — and sigma fits a graph by its longer axis, so six nodes used
 * 17% of the width of the box. A grid shaped to the box fills it. Above this
 * count the spiral is roughly circular and packs far better than a grid would.
 */
const GRID_MAX_CLUSTERS = 12;
/** Columns are biased by this much, because the graph box is wider than tall. */
const BOX_ASPECT = 1.7;

/** Cluster centres on a grid, spaced by the widest disc so none overlap. */
function gridCentres(radii: number[]): Point[] {
  const count = radii.length;
  const columns = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * BOX_ASPECT))));
  const rows = Math.ceil(count / columns);
  const step = 2 * Math.max(...radii) + CLUSTER_PADDING;
  return radii.map((_, i) => {
    const column = i % columns;
    const row = Math.floor(i / columns);
    return {
      x: (column - (columns - 1) / 2) * step,
      y: (row - (rows - 1) / 2) * step,
    };
  });
}

/**
 * Horizontal stretch applied to cluster centres. Deliberately 1.
 *
 * Stretching to the box's 16:10 looked obviously right and measured worse:
 * sigma fits the graph by its widest axis, so a wider layout is simply scaled
 * down. Vertical fill fell from 0.59 to 0.35, node overlaps went from 105 to
 * 303, and *fewer* topic names could be placed, not more. Left here as a
 * constant with the numbers attached so the next reader does not retry it.
 */
const ASPECT = 1;

/**
 * Threads in concentric rings around their topic, closest ring first.
 *
 * Rings rather than a single circle: a topic with 40 threads on one circle
 * needs a radius that would swallow its neighbours, and the ring count grows
 * with the square root of the thread count instead.
 */
function ringOffsets(count: number, inner: number): Point[] {
  const out: Point[] = [];
  let placed = 0;
  let ring = 1;
  while (placed < count) {
    // `inner` clears the topic's own marker. Without it the first ring landed
    // inside a large topic circle and its threads were drawn on top of it,
    // hiding both the topic and the edges that connect them.
    const radius = inner + ring * THREAD_SPACING;
    // Circumference divided by spacing, so density is the same on every ring.
    const capacity = Math.max(1, Math.floor((2 * Math.PI * radius) / THREAD_SPACING));
    const take = Math.min(capacity, count - placed);
    for (let i = 0; i < take; i++) {
      // Offset alternate rings by half a step so spokes do not line up.
      const angle = (2 * Math.PI * i) / take + (ring % 2 ? 0 : Math.PI / take);
      out.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
    placed += take;
    ring++;
  }
  return out;
}

/**
 * The topic's own marker, in layout units.
 *
 * Mirrors the size ramp the renderer uses (`TIER_SIZE.topic`, a square-root
 * scale on message count) so the rings clear the circle actually drawn rather
 * than a nominal one.
 */
function topicRadius(weight: number, maxWeight: number): number {
  return THREAD_SPACING * (0.5 + 1.5 * Math.sqrt(weight / Math.max(1, maxWeight)));
}

/** How much room a topic and its threads need. */
function clusterRadius(threadCount: number, inner: number): number {
  if (threadCount === 0) return Math.max(MIN_CLUSTER_RADIUS, inner + THREAD_SPACING);
  const rings = Math.ceil((-1 + Math.sqrt(1 + (4 * threadCount) / Math.PI)) / 2) || 1;
  return Math.max(MIN_CLUSTER_RADIUS, inner + rings * THREAD_SPACING + THREAD_SPACING);
}

/**
 * Cluster centres on an Archimedean spiral, stepped by each cluster's own
 * radius so discs never overlap.
 *
 * Biggest first: the large topics land near the middle where there is room,
 * and the long tail of one-thread topics fills the outside. A fixed-angle
 * arrangement would either waste the centre or collide at the rim.
 */
function spiralCentres(radii: number[]): Point[] {
  const out: Point[] = [];
  let angle = 0;
  let distance = 0;
  for (let i = 0; i < radii.length; i++) {
    const r = radii[i]!;
    if (i === 0) {
      out.push({ x: 0, y: 0 });
      distance = r + CLUSTER_PADDING;
      continue;
    }
    // Advance far enough around the current circle to clear the previous disc.
    const previous = radii[i - 1]!;
    const step = previous + r + CLUSTER_PADDING;
    angle += Math.min(Math.PI, step / Math.max(distance, 1e-6));
    if (angle > 2 * Math.PI) {
      angle -= 2 * Math.PI;
      distance += step;
    }
    out.push({ x: Math.cos(angle) * distance * ASPECT, y: Math.sin(angle) * distance });
  }
  return out;
}

/**
 * Position every node.
 *
 * People, when shown, are placed at the centroid of the threads they posted
 * in — so an account that works one topic sits in it, and one that works
 * across several sits between them. That is a statement about participation,
 * which is what the tier is for.
 */
export function layout(
  nodes: Placeable[],
  personThreads?: Map<string, string[]>,
): Map<string, Point> {
  const topics = nodes.filter((n) => n.tier === "topic");
  const threadsByCluster = new Map<string, Placeable[]>();
  for (const n of nodes) {
    if (n.tier !== "thread") continue;
    const list = threadsByCluster.get(n.cluster) ?? [];
    list.push(n);
    threadsByCluster.set(n.cluster, list);
  }

  // Every cluster that has anything in it, biggest first. Threads whose topic
  // is not on screen (the unassigned pile) form clusters of their own.
  const clusterKeys = [
    ...new Set([...topics.map((t) => t.cluster), ...threadsByCluster.keys()]),
  ].sort((a, b) => {
    const size = (k: string) => (threadsByCluster.get(k)?.length ?? 0);
    return size(b) - size(a) || a.localeCompare(b);
  });

  const maxTopicWeight = Math.max(1, ...topics.map((t) => t.weight));
  const innerByCluster = new Map(
    clusterKeys.map((k) => {
      const topic = topics.find((t) => t.cluster === k);
      return [k, topic ? topicRadius(topic.weight, maxTopicWeight) : 0];
    }),
  );
  const radii = clusterKeys.map((k) =>
    clusterRadius(threadsByCluster.get(k)?.length ?? 0, innerByCluster.get(k) ?? 0),
  );
  const centres =
    radii.length <= GRID_MAX_CLUSTERS ? gridCentres(radii) : spiralCentres(radii);

  const positions = new Map<string, Point>();
  clusterKeys.forEach((key, index) => {
    const centre = centres[index]!;
    const topic = topics.find((t) => t.cluster === key);
    if (topic) positions.set(topic.key, centre);

    // Biggest threads on the inner rings, where they are least likely to be
    // clipped and most likely to be read.
    const own = (threadsByCluster.get(key) ?? []).slice().sort((a, b) => b.weight - a.weight);
    const offsets = ringOffsets(own.length, innerByCluster.get(key) ?? 0);
    own.forEach((thread, i) => {
      const offset = offsets[i]!;
      positions.set(thread.key, { x: centre.x + offset.x, y: centre.y + offset.y });
    });
  });

  if (personThreads) {
    for (const node of nodes) {
      if (node.tier !== "person") continue;
      const threads = personThreads.get(node.key) ?? [];
      const points = threads
        .map((key) => positions.get(key))
        .filter((p): p is Point => Boolean(p));
      if (points.length === 0) {
        positions.set(node.key, { x: 0, y: 0 });
        continue;
      }
      positions.set(node.key, {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      });
    }
  }

  return positions;
}
