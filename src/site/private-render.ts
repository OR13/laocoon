/**
 * Rendering for the private, named-participant view.
 *
 * Kept apart from `render.ts` so the two never share a code path. That module
 * builds pages that may be published; this one builds a page that must not be,
 * and a helper reused across the boundary is how the wrong thing eventually
 * gets rendered into the wrong page.
 *
 * ## Why two graphs
 *
 * The **participation graph** is bipartite: people and threads are both nodes,
 * and an edge means "posted in". This is the standard treatment of threaded
 * conversation networks (Hansen, Shneiderman & Smith, *Visualizing Threaded
 * Conversation Networks*, 2010) and it answers a question the reply graph
 * structurally cannot — two people who never reply to each other but always turn
 * up in the same threads are adjacent here and invisible there.
 *
 * The **reply graph** is person to person, edge from the replier to the author
 * they replied to. It answers who engages with whom, and it is what reputation
 * propagates over.
 *
 * ## Encoding
 *
 * Three quantities, three separate channels, so none has to be inferred from
 * another:
 *
 *   * **size = volume** (messages sent), by area rather than radius.
 *   * **fill = reputation**, a single-hue sequential ramp on personalized
 *     PageRank. Sequential because reputation is a magnitude; one hue because a
 *     rainbow implies categories that are not there.
 *   * **border = community-conferred standing.** Thick solid means the seed rule
 *     matched, thin dashed means it did not. Border rather than hue keeps it
 *     legible for colour-blind readers and leaves fill free.
 *
 * The point of separating them: a **large pale** node is high volume with little
 * reception, which is exactly the pattern PROBLEM.md §1 exists to surface.
 *
 * Threads are rectangles and people are circles, so the bipartite structure
 * survives greyscale.
 *
 * Layout is fCoSE in the browser. It packs disconnected components instead of
 * flinging them to the margins, and it scales past the point where a
 * hand-rolled relaxation pass stops being viable.
 */

export interface PersonRow {
  id: string;
  messages: number;
  threads_participated: number;
  threads_started: number;
  replies_sent: number;
  replies_received: number;
  first_seen: string | null;
  last_seen: string | null;
  seeded: boolean;
  clauses: string[];
  unseeded_reason: string | null;
  ppr_replies: number | null;
  ppr_quoting: number | null;
  rank_replies: number | null;
  community: number | null;
  core_number: number | null;
  top_threads: { thread_id: string; messages: number }[];
}

export interface ThreadRow {
  id: string;
  subject: string;
  message_count: number;
  distinct_senders: number;
  max_depth: number;
  reply_pairs: number;
  mean_branching_factor: number;
  started_at: string | null;
  last_message_at: string | null;
  root_sender: string | null;
  substantive_reply_ratio: number | null;
  seeded_participants: number | null;
}

export interface SenderView {
  publication: string;
  generated_at: string;
  self_reply_edges_dropped: number;
  persons: PersonRow[];
  threads: ThreadRow[];
  participation: { person: string; thread: string; messages: number; replies: number }[];
  replies: { source: string; target: string; replies: number; quoting: number }[];
}

/** Surname with a leading initial. The full name is one click away. */
export function shortLabel(name: string): string {
  const cleaned = name.replace(/\s*\((IETF|ietf)\)\s*/g, " ").replace(/["']/g, "").trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 20);
  return `${parts[0]![0]}. ${parts[parts.length - 1]}`.slice(0, 22);
}

/** Subject with the list tag and reply prefixes stripped, for a node label. */
export function shortSubject(subject: string): string {
  const cleaned = subject
    .replace(/^\s*(\[[^\]]+\]\s*)+/g, "")
    .replace(/^((Re|RE|Fwd|FWD|AW)\s*:\s*)+/g, "")
    .trim();
  return (cleaned || subject).slice(0, 46);
}

const STYLE = `
:root{
  color-scheme: light dark;
  --surface:#fcfcfb; --panel:#ffffff; --ink:#0b0b0b; --ink2:#52514e; --ink3:#8b8a85;
  --line:#e2e2de; --line2:#c3c2bb;
  --seq-100:#cde2fb; --seq-250:#86b6ef; --seq-400:#3987e5; --seq-550:#1c5cab; --seq-700:#0d366b;
  --accent:#2a78d6; --thread:#8b8a85; --thread-bg:#eceae4;
  --warn:#8a5a00; --warn-bg:#fdf3e0;
}
@media (prefers-color-scheme: dark){
  :root{
    --surface:#1a1a19; --panel:#212120; --ink:#ffffff; --ink2:#c3c2b7; --ink3:#8d8c84;
    --line:#33332f; --line2:#4a4a44;
    --seq-100:#0d366b; --seq-250:#184f95; --seq-400:#256abf; --seq-550:#3987e5; --seq-700:#9ec5f4;
    --accent:#3987e5; --thread:#b0aea4; --thread-bg:#3b3b36;
    --warn:#d8a24a; --warn-bg:#2a2114;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--ink);
  font:14.5px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
.wrap{max-width:96rem;margin:0 auto;padding:0 1.25rem 4rem}
header{padding:1.5rem 0 .6rem}
h1{font-size:1.45rem;margin:0 0 .25rem;letter-spacing:-.02em}
h2{font-size:1.05rem;margin:2rem 0 .5rem;padding-bottom:.3rem;border-bottom:1px solid var(--line)}
p{color:var(--ink2);max-width:70ch;margin:.4rem 0}
.banner{background:var(--warn-bg);border:1px solid var(--line);border-left:3px solid var(--warn);
  padding:.7rem .95rem;border-radius:5px;margin:.9rem 0;font-size:.9rem}
.banner strong{color:var(--warn)}
.toolbar{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin:.9rem 0 .6rem;
  padding:.55rem .7rem;background:var(--panel);border:1px solid var(--line);border-radius:7px}
.toolbar label{font-size:.82rem;color:var(--ink2);display:flex;align-items:center;gap:.35rem}
.group{display:flex;border:1px solid var(--line2);border-radius:5px;overflow:hidden}
.group button{border:0;background:var(--panel);color:var(--ink2);padding:.32rem .7rem;
  font:inherit;font-size:.82rem;cursor:pointer}
.group button[aria-pressed="true"]{background:var(--accent);color:#fff}
input[type=search]{font:inherit;font-size:.82rem;padding:.3rem .5rem;border-radius:5px;
  border:1px solid var(--line2);background:var(--surface);color:var(--ink);min-width:13rem}
button.plain{border:1px solid var(--line2);background:var(--panel);color:var(--ink2);
  border-radius:5px;padding:.32rem .7rem;font:inherit;font-size:.82rem;cursor:pointer}
.stage{display:grid;grid-template-columns:1fr 21rem;gap:.8rem;align-items:start}
@media (max-width:68rem){.stage{grid-template-columns:1fr}}
#cy{height:min(74vh,760px);background:var(--panel);border:1px solid var(--line);border-radius:8px}
.side{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:.85rem .95rem;
  max-height:min(74vh,760px);overflow:auto}
.side h3{margin:.1rem 0;font-size:1rem;line-height:1.3}
.side .sub{color:var(--ink3);font-size:.76rem;word-break:break-all;margin:0 0 .5rem}
.side dl{display:grid;grid-template-columns:auto 1fr;gap:.18rem .7rem;margin:.4rem 0 0;font-size:.83rem}
.side dt{color:var(--ink3)}
.side dd{margin:0;font-variant-numeric:tabular-nums}
.side .empty{color:var(--ink3);font-size:.85rem}
.side ul{margin:.3rem 0 0;padding-left:1rem;font-size:.82rem}
.side li{margin:.14rem 0}
.chip{display:inline-block;font-size:.68rem;padding:.06rem .38rem;border-radius:3px;
  background:var(--line);color:var(--ink2);margin:.1rem .18rem .1rem 0}
.legend{display:flex;gap:1.1rem;flex-wrap:wrap;font-size:.78rem;color:var(--ink2);
  margin:.6rem 0 0;align-items:center}
.legend .sw{display:inline-block;width:.85rem;height:.85rem;border-radius:50%;
  border:2px solid var(--accent);vertical-align:-2px;margin-right:.3rem}
.legend .sw.rect{border-radius:2px;background:var(--thread-bg);border:1px solid var(--thread)}
.legend .sw.dash{border-style:dashed;border-width:1px}
.ramp{display:inline-block;width:5rem;height:.6rem;border-radius:2px;
  background:linear-gradient(90deg,var(--seq-100),var(--seq-400),var(--seq-700));
  border:1px solid var(--line2);vertical-align:-1px;margin:0 .3rem}
figcaption{color:var(--ink3);font-size:.8rem;margin-top:.6rem;max-width:76ch}
footer{margin-top:2.5rem;padding-top:.9rem;border-top:1px solid var(--line);
  color:var(--ink3);font-size:.8rem}
table{border-collapse:collapse;width:100%;font-size:.82rem;background:var(--panel)}
th,td{padding:.35rem .5rem;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
thead th{background:var(--surface);font-weight:600;position:sticky;top:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
td.name{white-space:normal;min-width:12rem;cursor:pointer}
td.name:hover{text-decoration:underline}
.scroll{overflow:auto;max-height:26rem;border:1px solid var(--line);border-radius:7px}
`;

export function renderPrivateView(
  view: SenderView,
  names: Map<string, { name: string; address: string }>,
  esc: (v: unknown) => string,
  bundle: string,
): string {
  const persons = view.persons.map((p) => {
    const rec = names.get(p.id);
    const full = rec?.name || rec?.address || p.id.slice(7, 19);
    return {
      ...p,
      full,
      address: rec?.address ?? "",
      label: shortLabel(rec?.name || rec?.address?.split("@")[0] || full),
    };
  });
  const threads = view.threads.map((t) => ({ ...t, label: shortSubject(t.subject) }));

  const payload = {
    persons,
    threads,
    participation: view.participation,
    replies: view.replies,
  };
  const seeded = view.persons.filter((p) => p.seeded).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>LAOCOÖN — private participation graph</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Participation and reply graph</h1>
  <p>Who engages with which threads, and who replies to whom. Click any node — or
  any name in the tables — for a profile.</p>
</header>

<div class="banner">
  <strong>Private — never publish this page.</strong> It names participants and
  ranks them, which PROBLEM.md §7 keeps out of publication. §7 makes this private
  <em>to Orie</em>, not nonexistent — this is the operator's working view. It lives
  under <code>private/</code>, which is gitignored, and the site build cannot reach
  it. Every number is a count of messages or a position in a graph: none of it
  judges anyone's contribution, and none of it says anything about how any message
  was written.
</div>

<div class="toolbar">
  <span class="group" role="group" aria-label="Graph mode">
    <button id="m-both" aria-pressed="true">Participation + replies</button>
    <button id="m-part" aria-pressed="false">Participation</button>
    <button id="m-reply" aria-pressed="false">Replies</button>
  </span>
  <label>Min thread size <input id="minsize" type="range" min="1" max="10" value="2">
    <span id="minsize-val">2</span></label>
  <label><input id="hide-iso" type="checkbox"> Hide unconnected</label>
  <input id="search" type="search" placeholder="Find a person or thread…" aria-label="Search">
  <button class="plain" id="relayout">Re-run layout</button>
  <button class="plain" id="fit">Fit</button>
  <span id="counts" style="font-size:.8rem;color:var(--ink3)"></span>
</div>

<div class="stage">
  <div id="cy" role="application" aria-label="Participation graph"></div>
  <aside class="side" id="side">
    <p class="empty">Click a node to see its profile. Circles are people,
    rectangles are threads.</p>
  </aside>
</div>

<div class="legend">
  <span><i class="sw" style="background:var(--seq-700)"></i> person</span>
  <span>reputation <span class="ramp"></span> low → high</span>
  <span><i class="sw" style="background:var(--seq-250);border-width:3px"></i> thick ring: community-conferred standing (${seeded} of ${view.persons.length})</span>
  <span><i class="sw dash" style="background:var(--seq-100)"></i> dashed: no standing</span>
  <span><i class="sw rect"></i> thread</span>
  <span>node area ∝ messages</span>
</div>
<figcaption>Layout is fCoSE, run in the browser and re-runnable; it is
force-directed, so the picture differs slightly between runs. Reputation is
personalized PageRank restarted on accounts holding community-conferred standing,
over edges pointing from a replier to the author they replied to — it measures
whose messages drew engagement from the established part of the group, and it is
a graph position, not a measure of anyone's worth. More colour means more reputation in both
themes, and fill is assigned by <em>rank</em> within the corpus rather than by
raw score, so a long tail of near-zero values still separates visually. A
<strong>large, faint</strong> node is high volume with little reception, which is
the pattern this project exists to surface. Threads with a single message are
hidden by default — they have no reply structure; the slider brings them back. ${view.self_reply_edges_dropped} self-replies are excluded: answering
your own message is not evidence of anyone else's engagement.</figcaption>

<h2>People</h2>
<div class="scroll">
<table id="people">
<thead><tr><th>Name</th><th class="num">Msgs</th><th class="num">Threads</th>
<th class="num">Started</th><th class="num">Sent</th><th class="num">Recv</th>
<th class="num">Rank</th><th class="num">PPR</th><th class="num">Cmty</th>
<th class="num">Core</th><th>Standing</th></tr></thead>
<tbody></tbody>
</table>
</div>

<h2>Threads</h2>
<div class="scroll">
<table id="threadtable">
<thead><tr><th>Subject</th><th class="num">Msgs</th><th class="num">People</th>
<th class="num">Depth</th><th class="num">Branching</th><th class="num">With standing</th>
<th>Started</th></tr></thead>
<tbody></tbody>
</table>
</div>

<footer>
  <p>Generated ${esc(view.generated_at)} · ${view.persons.length} people ·
  ${view.threads.length} threads · ${view.participation.length} participation edges ·
  ${view.replies.length} reply edges. Private working view: not published, not
  committed, not deployed.</p>
</footer>
</div>

<script>${bundle}</script>
<script id="data" type="application/json">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>
<script>${CLIENT}</script>
</body>
</html>
`;
}

/**
 * Browser code, inlined so the page is one self-contained file the operator can
 * open from disk with no server and no network.
 */
const CLIENT = String.raw`
(function () {
  var data = JSON.parse(document.getElementById("data").textContent);
  var personById = {}, threadById = {};
  data.persons.forEach(function (p) { personById[p.id] = p; });
  data.threads.forEach(function (t) { threadById[t.id] = t; });

  var css = getComputedStyle(document.documentElement);
  function v(n) { return css.getPropertyValue(n).trim(); }
  var RAMP = ["--seq-100","--seq-250","--seq-400","--seq-550","--seq-700"].map(v);

  var maxMsg = Math.max.apply(null, data.persons.map(function (p) { return p.messages; }).concat([1]));
  var maxThread = Math.max.apply(null, data.threads.map(function (t) { return t.message_count; }).concat([1]));

  // Fill by rank, not raw score: personalized PageRank has a long near-zero
  // tail, and a linear ramp would collapse most of the corpus into one shade.
  var order = data.persons.slice().sort(function (a, b) {
    return (a.ppr_replies || 0) - (b.ppr_replies || 0);
  });
  var rankOf = {};
  order.forEach(function (p, i) { rankOf[p.id] = order.length > 1 ? i / (order.length - 1) : 1; });
  function fillFor(p) {
    return RAMP[Math.min(RAMP.length - 1, Math.floor(rankOf[p.id] * RAMP.length))];
  }

  var elements = [];
  data.persons.forEach(function (p) {
    elements.push({ data: { id: "p:" + p.id, kind: "person", label: p.label, ref: p.id,
      sz: 16 + 40 * Math.sqrt(p.messages / maxMsg), fill: fillFor(p),
      seeded: p.seeded ? "yes" : "no" } });
  });
  data.threads.forEach(function (t) {
    elements.push({ data: { id: "t:" + t.id, kind: "thread", label: t.label, ref: t.id,
      sz: 22 + 60 * Math.sqrt(t.message_count / maxThread),
      hh: 14 + 16 * Math.sqrt(t.message_count / maxThread) } });
  });
  data.participation.forEach(function (e, i) {
    elements.push({ data: { id: "part" + i, kind: "part", source: "p:" + e.person,
      target: "t:" + e.thread, w: 0.7 + 2.0 * Math.sqrt(e.messages) } });
  });
  data.replies.forEach(function (e, i) {
    elements.push({ data: { id: "rep" + i, kind: "reply", source: "p:" + e.source,
      target: "p:" + e.target, w: 0.8 + 1.4 * Math.sqrt(e.replies) } });
  });

  var cy = cytoscape({
    container: document.getElementById("cy"),
    elements: elements,
    wheelSensitivity: 0.2,
    style: [
      { selector: 'node[kind="person"]', style: {
        "background-color": "data(fill)", "border-color": v("--accent"),
        "width": "data(sz)", "height": "data(sz)",
        "label": "data(label)", "font-size": 11, "color": v("--ink"),
        "text-outline-color": v("--panel"), "text-outline-width": 2.5,
        "text-valign": "bottom", "text-margin-y": 3, "min-zoomed-font-size": 7 } },
      { selector: 'node[kind="person"][seeded="yes"]', style: {
        "border-width": 3.5, "border-style": "solid" } },
      { selector: 'node[kind="person"][seeded="no"]', style: {
        "border-width": 1.5, "border-style": "dashed" } },
      { selector: 'node[kind="thread"]', style: {
        "shape": "round-rectangle", "background-color": v("--thread-bg"),
        "border-color": v("--thread"), "border-width": 1.2,
        "width": "data(sz)", "height": "data(hh)",
        "label": "data(label)", "font-size": 10, "color": v("--ink2"),
        "text-outline-color": v("--panel"), "text-outline-width": 2.5,
        "text-valign": "bottom", "text-margin-y": 3,
        "text-wrap": "ellipsis", "text-max-width": 160,
        "min-zoomed-font-size": 8 } },
      { selector: 'edge[kind="part"]', style: {
        "width": "data(w)", "line-color": v("--line2"), "opacity": 0.5,
        "curve-style": "straight" } },
      { selector: 'edge[kind="reply"]', style: {
        "width": "data(w)", "line-color": v("--accent"), "opacity": 0.45,
        "curve-style": "bezier", "control-point-step-size": 26,
        "target-arrow-shape": "triangle", "target-arrow-color": v("--accent"),
        "arrow-scale": 0.75 } },
      { selector: ".dim", style: { "opacity": 0.07, "text-opacity": 0 } },
      { selector: ".pick", style: { "border-color": v("--warn"), "border-width": 4,
        "z-index": 99 } }
    ]
  });

  var LAYOUT = { name: "fcose", quality: "proof", animate: false, randomize: true,
    nodeSeparation: 120, nodeRepulsion: 9000, gravity: 0.2,
    idealEdgeLength: function (e) { return e.data("kind") === "part" ? 80 : 130; },
    packComponents: true, tile: true, tilingPaddingVertical: 28,
    tilingPaddingHorizontal: 28, padding: 26 };

  function relayout() {
    var t0 = performance.now();
    cy.layout(LAYOUT).run();
    cy.fit(undefined, 26);
    document.getElementById("counts").textContent =
      cy.nodes(":visible").length + " nodes, " + cy.edges(":visible").length +
      " edges · layout " + Math.round(performance.now() - t0) + " ms";
  }

  var mode = "both", minSize = 2, hideIso = false;
  function applyFilters() {
    cy.batch(function () {
      cy.elements().style("display", "element");
      if (mode === "part") cy.edges('[kind="reply"]').style("display", "none");
      if (mode === "reply") {
        cy.edges('[kind="part"]').style("display", "none");
        cy.nodes('[kind="thread"]').style("display", "none");
      }
      if (minSize > 1) {
        cy.nodes('[kind="thread"]').forEach(function (n) {
          var t = threadById[n.data("ref")];
          if (t && t.message_count < minSize) n.style("display", "none");
        });
      }
      if (hideIso) {
        cy.nodes().forEach(function (n) {
          if (n.style("display") === "none") return;
          var live = n.connectedEdges().filter(function (e) {
            return e.style("display") !== "none" &&
              e.source().style("display") !== "none" &&
              e.target().style("display") !== "none";
          });
          if (live.length === 0) n.style("display", "none");
        });
      }
    });
    relayout();
  }

  function setMode(next) {
    mode = next;
    [["both","m-both"],["part","m-part"],["reply","m-reply"]].forEach(function (pr) {
      document.getElementById(pr[1]).setAttribute("aria-pressed", String(pr[0] === next));
    });
    applyFilters();
  }
  document.getElementById("m-both").onclick = function () { setMode("both"); };
  document.getElementById("m-part").onclick = function () { setMode("part"); };
  document.getElementById("m-reply").onclick = function () { setMode("reply"); };
  document.getElementById("minsize").oninput = function () {
    minSize = Number(this.value);
    document.getElementById("minsize-val").textContent = String(minSize);
  };
  document.getElementById("minsize").onchange = applyFilters;
  document.getElementById("hide-iso").onchange = function () {
    hideIso = this.checked; applyFilters();
  };
  document.getElementById("relayout").onclick = relayout;
  document.getElementById("fit").onclick = function () { cy.fit(undefined, 26); };

  var side = document.getElementById("side");
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
    });
  }
  function day(s) { return s ? String(s).slice(0, 10) : "—"; }
  function num(x, d) {
    return (x === null || x === undefined) ? "—" : (d ? Number(x).toFixed(d) : String(x));
  }

  function personPanel(p) {
    var list = p.top_threads.map(function (r) {
      var t = threadById[r.thread_id];
      return "<li><a href='#' data-goto='t:" + esc(r.thread_id) + "'>" +
        esc(t ? t.subject.replace(/^\[[^\]]+\]\s*/, "") : r.thread_id) +
        "</a> <span style='color:var(--ink3)'>(" + r.messages + ")</span></li>";
    }).join("");
    var standing = p.seeded
      ? p.clauses.map(function (c) { return "<span class='chip'>" + esc(c) + "</span>"; }).join("")
      : "<span style='color:var(--ink3)'>" + esc(p.unseeded_reason || "no clause matched") + "</span>";
    return "<h3>" + esc(p.full) + "</h3>" +
      "<p class='sub'>" + esc(p.address || "address not recorded") + "</p><dl>" +
      "<dt>Messages</dt><dd>" + p.messages + "</dd>" +
      "<dt>Threads</dt><dd>" + p.threads_participated + " (" + p.threads_started + " started)</dd>" +
      "<dt>Replies sent</dt><dd>" + p.replies_sent + "</dd>" +
      "<dt>Replies received</dt><dd>" + p.replies_received + "</dd>" +
      "<dt>Reputation</dt><dd>" + num(p.ppr_replies, 4) + " (rank " + num(p.rank_replies) + ")</dd>" +
      "<dt>Quote-weighted</dt><dd>" + num(p.ppr_quoting, 4) + "</dd>" +
      "<dt>Community</dt><dd>" + num(p.community) + "</dd>" +
      "<dt>k-core</dt><dd>" + num(p.core_number) + "</dd>" +
      "<dt>First seen</dt><dd>" + day(p.first_seen) + "</dd>" +
      "<dt>Last seen</dt><dd>" + day(p.last_seen) + "</dd></dl>" +
      "<p style='margin-top:.6rem'><strong style='font-size:.82rem'>Standing</strong><br>" +
      standing + "</p>" +
      (list ? "<p style='margin-top:.5rem'><strong style='font-size:.82rem'>Most active in</strong></p><ul>" + list + "</ul>" : "") +
      "<p style='margin-top:.7rem;font-size:.77rem;color:var(--ink3)'>Reputation is a " +
      "position in the reply graph. It is not a judgement of this person's " +
      "contribution, and nothing here concerns how their messages were written.</p>";
  }

  function threadPanel(t) {
    var who = data.participation.filter(function (e) { return e.thread === t.id; })
      .sort(function (a, b) { return b.messages - a.messages; })
      .map(function (e) {
        var p = personById[e.person];
        return "<li><a href='#' data-goto='p:" + esc(e.person) + "'>" +
          esc(p ? p.full : e.person) + "</a> <span style='color:var(--ink3)'>(" +
          e.messages + ")</span></li>";
      }).join("");
    return "<h3>" + esc(t.subject) + "</h3><p class='sub'>" + esc(t.id) + "</p><dl>" +
      "<dt>Messages</dt><dd>" + t.message_count + "</dd>" +
      "<dt>Participants</dt><dd>" + t.distinct_senders + "</dd>" +
      "<dt>Max depth</dt><dd>" + t.max_depth + "</dd>" +
      "<dt>Reply pairs</dt><dd>" + t.reply_pairs + "</dd>" +
      "<dt>Branching</dt><dd>" + num(t.mean_branching_factor, 2) + "</dd>" +
      "<dt>With standing</dt><dd>" + num(t.seeded_participants) + "</dd>" +
      "<dt>Substantive</dt><dd>" +
      ((t.substantive_reply_ratio === null || t.substantive_reply_ratio === undefined)
        ? "<span style='color:var(--ink3)'>not measured</span>"
        : Math.round(t.substantive_reply_ratio * 100) + "%") + "</dd>" +
      "<dt>Started</dt><dd>" + day(t.started_at) + "</dd>" +
      "<dt>Last message</dt><dd>" + day(t.last_message_at) + "</dd></dl>" +
      (who ? "<p style='margin-top:.5rem'><strong style='font-size:.82rem'>Who posted</strong></p><ul>" + who + "</ul>" : "");
  }

  function select(node) {
    cy.elements().removeClass("pick dim");
    if (!node || !node.length) {
      side.innerHTML = "<p class='empty'>Click a node to see its profile. Circles " +
        "are people, rectangles are threads.</p>";
      return;
    }
    cy.elements().difference(node.closedNeighborhood()).addClass("dim");
    node.addClass("pick");
    side.innerHTML = node.data("kind") === "person"
      ? personPanel(personById[node.data("ref")])
      : threadPanel(threadById[node.data("ref")]);
    side.scrollTop = 0;
  }
  function goto(id) {
    var n = cy.getElementById(id);
    if (!n || !n.length) return;
    select(n);
    cy.animate({ center: { eles: n }, zoom: 1.25 }, { duration: 220 });
  }
  cy.on("tap", "node", function (e) { select(e.target); });
  cy.on("tap", function (e) { if (e.target === cy) select(null); });

  document.getElementById("search").oninput = function () {
    var q = this.value.trim().toLowerCase();
    cy.elements().removeClass("dim");
    if (!q) return;
    var hit = cy.nodes().filter(function (n) {
      var p = personById[n.data("ref")], t = threadById[n.data("ref")];
      var hay = p ? (p.full + " " + (p.address || "")) : (t ? t.subject : "");
      return hay.toLowerCase().indexOf(q) !== -1;
    });
    if (hit.length) cy.elements().difference(hit.closedNeighborhood()).addClass("dim");
  };

  var pbody = document.querySelector("#people tbody");
  data.persons.forEach(function (p) {
    var tr = document.createElement("tr");
    tr.innerHTML = "<td class='name' data-goto='p:" + esc(p.id) + "'>" + esc(p.full) + "</td>" +
      "<td class='num'>" + p.messages + "</td><td class='num'>" + p.threads_participated +
      "</td><td class='num'>" + p.threads_started + "</td><td class='num'>" + p.replies_sent +
      "</td><td class='num'>" + p.replies_received + "</td><td class='num'>" +
      num(p.rank_replies) + "</td><td class='num'>" + num(p.ppr_replies, 4) +
      "</td><td class='num'>" + num(p.community) + "</td><td class='num'>" +
      num(p.core_number) + "</td><td>" +
      (p.seeded ? p.clauses.map(function (c) { return "<span class='chip'>" + esc(c) + "</span>"; }).join("")
                : "<span style='color:var(--ink3)'>" + esc(p.unseeded_reason || "") + "</span>") +
      "</td>";
    pbody.appendChild(tr);
  });
  var tbody = document.querySelector("#threadtable tbody");
  data.threads.forEach(function (t) {
    var tr = document.createElement("tr");
    tr.innerHTML = "<td class='name' data-goto='t:" + esc(t.id) + "'>" + esc(t.subject) + "</td>" +
      "<td class='num'>" + t.message_count + "</td><td class='num'>" + t.distinct_senders +
      "</td><td class='num'>" + t.max_depth + "</td><td class='num'>" +
      num(t.mean_branching_factor, 2) + "</td><td class='num'>" +
      num(t.seeded_participants) + "</td><td>" + day(t.started_at) + "</td>";
    tbody.appendChild(tr);
  });

  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-goto]") : null;
    if (!el) return;
    e.preventDefault();
    goto(el.getAttribute("data-goto"));
    document.getElementById("cy").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  applyFilters();
  window.__cyReady = true;
})();
`;
