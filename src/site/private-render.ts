/**
 * Rendering for the private, named-participant view.
 *
 * Kept apart from `render.ts` so the two never share a code path. That module
 * builds pages that may be published; this one builds a page that must not be,
 * and a helper reused across the boundary is how the wrong thing eventually
 * gets rendered into the wrong page.
 *
 * Encoding choices, and why:
 *
 *   * **Position** comes from a seeded force layout computed in Python, so the
 *     same corpus always draws the same picture and two runs are comparable.
 *   * **Fill, not hue, carries community-conferred standing.** Filled means the
 *     seed rule matched; hollow means it did not. Fill-versus-hollow survives
 *     colour-blindness and greyscale printing, and it leaves hue free.
 *   * **Community is a number in the table, not a colour.** Eight categorical
 *     hues cannot be told apart reliably when every pair is on screen at once,
 *     which is exactly the case in a node-link diagram. Position already shows
 *     the clustering.
 *   * **Node area is proportional to messages sent** — area, not radius, so a
 *     sender with four times the messages looks four times as large.
 *   * **Edge width is reply count**, direction is replier → the author replied to.
 */

export interface SenderRow {
  sender_id: string;
  messages: number;
  threads_participated: number;
  replies_sent: number;
  replies_received: number;
  first_seen: string | null;
  last_seen: string | null;
  seeded: boolean;
  clauses: string[];
  unseeded_reason: string | null;
  ppr_replies: number | null;
  rank_replies: number | null;
  community: number | null;
  core_number: number | null;
  x: number;
  y: number;
}

export interface SenderView {
  publication: string;
  generated_at: string;
  layout_seed: number;
  self_reply_edges_dropped: number;
  senders: SenderRow[];
  edges: { source: string; target: string; replies: number; quoting: number }[];
  threads: { thread_id: string; subject: string; message_count: number }[];
  matrix: { sender_id: string; thread_id: string; messages: number }[];
}

const W = 1120;
const H = 620;
const PAD = 54;

const STYLE = `
:root{
  color-scheme: light dark;
  --surface:#fcfcfb; --panel:#ffffff; --ink:#0b0b0b; --ink2:#52514e; --ink3:#8b8a85;
  --line:#e2e2de; --line2:#c3c2bb;
  --series-1:#2a78d6; --warn:#8a5a00; --warn-bg:#fdf3e0; --danger:#e34948;
}
@media (prefers-color-scheme: dark){
  :root{
    --surface:#1a1a19; --panel:#212120; --ink:#ffffff; --ink2:#c3c2b7; --ink3:#8d8c84;
    --line:#33332f; --line2:#4a4a44;
    --series-1:#3987e5; --warn:#d8a24a; --warn-bg:#2a2114; --danger:#e66767;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--ink);padding:0 1.5rem 5rem;
  font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:76rem;margin:0 auto}
header{padding:2rem 0 1rem}
h1{font-size:1.6rem;margin:0 0 .3rem;letter-spacing:-.02em}
h2{font-size:1.1rem;margin:2.5rem 0 .5rem;padding-bottom:.3rem;border-bottom:1px solid var(--line)}
p{max-width:66ch;color:var(--ink2)}
.banner{background:var(--warn-bg);border:1px solid var(--line);border-left:3px solid var(--warn);
  padding:.8rem 1rem;border-radius:5px;margin:1rem 0}
.banner strong{color:var(--warn)}
figure{margin:1.25rem 0;background:var(--panel);border:1px solid var(--line);
  border-radius:8px;padding:1rem}
figcaption{color:var(--ink3);font-size:.82rem;margin-top:.75rem;max-width:70ch}
.scroll{overflow-x:auto}
svg{display:block;max-width:100%;height:auto}
table{border-collapse:collapse;width:100%;font-size:.83rem;background:var(--panel)}
th,td{padding:.4rem .55rem;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
thead th{background:var(--surface);font-weight:600;position:sticky;top:0;z-index:1}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
td.name{white-space:normal;min-width:13rem}
td.addr{color:var(--ink3);font-family:ui-monospace,Menlo,monospace;font-size:.75rem}
.dot{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;margin-right:.4rem;
  border:1.5px solid var(--series-1);vertical-align:baseline}
.dot.on{background:var(--series-1)}
.legend{display:flex;gap:1.4rem;flex-wrap:wrap;font-size:.8rem;color:var(--ink2);margin-top:.8rem}
.legend span{display:flex;align-items:center;gap:.4rem}
.matrix td{padding:0;border:none}
.matrix th.rot{height:9.5rem;vertical-align:bottom;padding:0 0 .3rem}
.matrix th.rot div{writing-mode:vertical-rl;transform:rotate(180deg);
  font-weight:500;font-size:.72rem;max-height:9rem;overflow:hidden;text-overflow:ellipsis;
  color:var(--ink2)}
.cell{width:1.35rem;height:1.35rem;border:1px solid var(--surface);display:block}
.chip{display:inline-block;font-size:.68rem;padding:.05rem .35rem;border-radius:3px;
  background:var(--line);color:var(--ink2);margin-right:.2rem}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);
  color:var(--ink3);font-size:.82rem}
`;

/** Node radius from message count: area proportional, so 4x messages = 4x area. */
function radius(messages: number, max: number): number {
  const min = 4.5;
  const span = 17;
  return min + span * Math.sqrt(messages / Math.max(1, max));
}

export function renderPrivateView(
  view: SenderView,
  names: Map<string, { name: string; address: string }>,
  esc: (v: unknown) => string,
): string {
  const label = (id: string): string => {
    const rec = names.get(id);
    if (rec?.name) return rec.name;
    if (rec?.address) return rec.address.split("@")[0]!;
    return id.slice(7, 13);
  };

  const byId = new Map(view.senders.map((s) => [s.sender_id, s]));
  const maxMessages = Math.max(...view.senders.map((s) => s.messages), 1);
  const maxReplies = Math.max(...view.edges.map((e) => e.replies), 1);

  const px = (s: SenderRow): number => PAD + s.x * (W - 2 * PAD);
  const py = (s: SenderRow): number => PAD + s.y * (H - 2 * PAD);

  // Edges first so nodes sit on top of them.
  const edgeMarks = view.edges
    .map((e) => {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) return "";
      const width = 0.7 + 2.6 * (e.replies / maxReplies);
      const opacity = 0.22 + 0.4 * (e.replies / maxReplies);
      return (
        `<line x1="${px(a).toFixed(1)}" y1="${py(a).toFixed(1)}" ` +
        `x2="${px(b).toFixed(1)}" y2="${py(b).toFixed(1)}" ` +
        `stroke="var(--ink2)" stroke-opacity="${opacity.toFixed(2)}" ` +
        `stroke-width="${width.toFixed(2)}" stroke-linecap="round"><title>` +
        `${esc(label(e.source))} → ${esc(label(e.target))}: ${e.replies} ` +
        `${e.replies === 1 ? "reply" : "replies"}, ${e.quoting} quoting</title></line>`
      );
    })
    .join("\n");

  const nodeMarks = view.senders
    .map((s) => {
      const r = radius(s.messages, maxMessages);
      const fill = s.seeded ? "var(--series-1)" : "var(--panel)";
      const title =
        `${label(s.sender_id)} — ${s.messages} messages in ${s.threads_participated} threads; ` +
        `${s.replies_sent} replies sent, ${s.replies_received} received; ` +
        `${s.seeded ? "community-conferred standing" : "no standing under the seed rule"}`;
      return (
        `<g><circle cx="${px(s).toFixed(1)}" cy="${py(s).toFixed(1)}" r="${r.toFixed(1)}" ` +
        `fill="${fill}" stroke="var(--series-1)" stroke-width="1.8"><title>${esc(title)}</title></circle>` +
        `<text x="${px(s).toFixed(1)}" y="${(py(s) + r + 11).toFixed(1)}" text-anchor="middle" ` +
        `font-size="10.5" fill="var(--ink2)">${esc(label(s.sender_id))}</text></g>`
      );
    })
    .join("\n");

  // ---- sender x thread matrix -------------------------------------------
  const cell = new Map(view.matrix.map((m) => [`${m.sender_id}|${m.thread_id}`, m.messages]));
  const maxCell = Math.max(...view.matrix.map((m) => m.messages), 1);
  const threads = view.threads.filter((t) => t.message_count > 1);
  const matrixHead = threads
    .map((t) => `<th class="rot"><div>${esc(t.subject.replace(/^\[Agentproto\]\s*/, ""))}</div></th>`)
    .join("");
  const matrixRows = view.senders
    .map((s) => {
      const cells = threads
        .map((t) => {
          const n = cell.get(`${s.sender_id}|${t.thread_id}`) ?? 0;
          const o = n === 0 ? 0 : 0.18 + 0.82 * (n / maxCell);
          const bg = n === 0 ? "var(--line)" : `color-mix(in oklab, var(--series-1) ${Math.round(o * 100)}%, transparent)`;
          return `<td><span class="cell" style="background:${bg}" title="${esc(label(s.sender_id))} — ${n} in ${esc(t.subject)}"></span></td>`;
        })
        .join("");
      return `<tr><td class="name"><span class="dot${s.seeded ? " on" : ""}"></span>${esc(label(s.sender_id))}</td>${cells}</tr>`;
    })
    .join("\n");

  // ---- per-sender table --------------------------------------------------
  const tableRows = view.senders
    .map((s) => {
      const rec = names.get(s.sender_id);
      const standing = s.seeded
        ? s.clauses.map((c) => `<span class="chip">${esc(c)}</span>`).join("")
        : `<span style="color:var(--ink3)">${esc(s.unseeded_reason ?? "not seeded")}</span>`;
      return (
        `<tr><td class="name"><span class="dot${s.seeded ? " on" : ""}"></span>${esc(label(s.sender_id))}</td>` +
        `<td class="addr">${esc(rec?.address ?? "—")}</td>` +
        `<td class="num">${s.messages}</td>` +
        `<td class="num">${s.threads_participated}</td>` +
        `<td class="num">${s.replies_sent}</td>` +
        `<td class="num">${s.replies_received}</td>` +
        `<td class="num">${s.rank_replies ?? "—"}</td>` +
        `<td class="num">${s.ppr_replies === null ? "—" : s.ppr_replies.toFixed(4)}</td>` +
        `<td class="num">${s.community ?? "—"}</td>` +
        `<td class="num">${s.core_number ?? "—"}</td>` +
        `<td>${standing}</td></tr>`
      );
    })
    .join("\n");

  const seeded = view.senders.filter((s) => s.seeded).length;
  const isolated = view.senders.filter((s) => s.replies_sent === 0 && s.replies_received === 0).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>LAOCOÖN — private sender view</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
  <h1>Senders and their engagement</h1>
  <p>Who replied to whom, and which threads each person took part in.</p>
</header>

<div class="banner">
  <strong>Private — never publish this page.</strong> It names participants and
  ranks them, which PROBLEM.md §7 keeps out of publication. §7 makes this data
  private <em>to Orie</em>, not nonexistent — this is the operator's working view.
  It lives under <code>private/</code>, which is gitignored, and the site build
  cannot reach it. Nothing here is a judgement of anyone's contribution: every
  number is a count of messages or graph position, and none of it says anything
  about how any message was written.
</div>

<h2>Reply network</h2>
<figure>
<div class="scroll">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Force-directed graph of senders connected by replies">
${edgeMarks}
${nodeMarks}
</svg>
</div>
<div class="legend">
  <span><i class="dot on"></i> community-conferred standing (${seeded} of ${view.senders.length})</span>
  <span><i class="dot"></i> no standing under the seed rule</span>
  <span>node area ∝ messages sent</span>
  <span>edge width ∝ replies</span>
  <span>hover any node or edge for counts</span>
</div>
<figcaption>An edge runs from the person who replied to the person they replied
to. Layout is a seeded force solver, so the same corpus always draws the same
picture. The ${isolated} accounts along the bottom have no reply edges at all —
they posted and drew no reply, and replied to nobody; the solver would otherwise
fling them to the margins as if that were meaningful.
${view.self_reply_edges_dropped} self-replies are excluded: answering your own
message is not evidence of anyone else's engagement.</figcaption>
</figure>

<h2>Who was in which thread</h2>
<figure>
<div class="scroll">
<table class="matrix">
<thead><tr><th>Sender</th>${matrixHead}</tr></thead>
<tbody>
${matrixRows}
</tbody>
</table>
</div>
<figcaption>Shade is messages sent by that person in that thread. Threads with a
single message are omitted. Rows keep the ranking of the table below; columns run
from the largest thread to the smallest.</figcaption>
</figure>

<h2>Per sender</h2>
<div class="scroll">
<table>
<thead><tr>
  <th>Sender</th><th>Address</th><th class="num">Msgs</th><th class="num">Threads</th>
  <th class="num">Replies sent</th><th class="num">Replies recv</th>
  <th class="num">Rank</th><th class="num">PPR</th>
  <th class="num">Cmty</th><th class="num">Core</th><th>Standing</th>
</tr></thead>
<tbody>
${tableRows}
</tbody>
</table>
</div>
<p style="font-size:.85rem"><strong>PPR</strong> is personalized PageRank restarted
on the accounts holding community-conferred standing, over edges pointing from a
replier to the author they replied to — so it measures whose messages drew
engagement from the established part of the group. It is a position in a graph,
not a measure of anybody's worth. <strong>Cmty</strong> is the Louvain community
index at modularity 0.373, which is weak at this size and should not be leaned on.
<strong>Core</strong> is the k-core number.</p>

<footer>
  <p>Generated ${esc(view.generated_at)} · layout seed ${view.layout_seed} ·
  ${view.senders.length} senders, ${view.edges.length} reply edges,
  ${view.threads.length} threads.</p>
  <p>Private working view. Not published, not committed, not deployed.</p>
</footer>
</main>
</body>
</html>
`;
}
