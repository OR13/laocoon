#!/usr/bin/env bun
/**
 * Build the static site.
 *
 *   bun run site
 *
 * Reads the public event log and the aggregate artifacts, and writes `site/`.
 * It does **not** deploy: this is a public repository and publishing is the
 * operator's decision (INVARIANTS.md #5). Enabling Pages is a separate,
 * deliberate step, documented in docs/phase-4.md.
 *
 * The build refuses rather than trusts. Only whitelisted event types are read,
 * every aggregate artifact must declare `publication: aggregate_public`, and
 * every generated file is scanned for a sender hash before it is written. The
 * cost of getting this wrong is a published file, which cannot be unpublished.
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Event } from "../schema/generated.ts";
import { JsonlEventStore } from "../store/jsonl-store.ts";
import {
  assertNoSenderHash,
  assertPublishableArtifact,
  selectPublishable,
} from "../site/publishable.ts";
import { escapeHtml, numberCell, page, ratioCell } from "../site/render.ts";
import { PROMPT_HASH } from "../classify/prompt.ts";
import { ARTIFACTS_DIR, EVENTS_DIR, repoPath } from "../lib/paths.ts";

const SITE_DIR = repoPath("site");
const generatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");

const store = new JsonlEventStore<Event>(EVENTS_DIR, "event");
const events: Event[] = [];
for await (const event of store.read()) events.push(event);
const { measures, forecasts, windows } = selectPublishable(events);

const structurePath = join(ARTIFACTS_DIR, "community-structure.json");
const structure = (await Bun.file(structurePath).exists())
  ? await Bun.file(structurePath).json()
  : null;
if (structure) assertPublishableArtifact(structurePath, structure);

const lastWindow = windows[windows.length - 1];
const coverageNote = lastWindow
  ? `Coverage: ${lastWindow.list_name}, ${lastWindow.mailbox_total} messages in the mailbox ` +
    `as of ${lastWindow.completed_at}, ${lastWindow.failures.length} fetch failures.`
  : "Coverage: no crawl window recorded.";

// ---------------------------------------------------------------- threads --

const measureColumns: [string, string][] = [
  ["messages_total", "Messages"],
  ["distinct_senders", "Participants"],
  ["max_depth", "Depth"],
  ["mean_branching_factor", "Branching"],
  ["seeded_participants", "With standing"],
  ["max_core_number", "Max core"],
];

const threadRows = measures
  .map((m) => {
    const cells = measureColumns
      .map(([key]) => numberCell(Number((m as unknown as Record<string, number>)[key])))
      .join("");
    return (
      `<tr><td class="subject">${escapeHtml(m.subject || "(no subject)")}</td>` +
      cells +
      ratioCell(m.substantive_reply_ratio) +
      ratioCell(m.quoting_reply_ratio) +
      ratioCell(m.new_participant_share) +
      numberCell(m.unclassified_replies) +
      `</tr>`
    );
  })
  .join("\n");

const totals = {
  threads: measures.length,
  messages: measures.reduce((n, m) => n + m.messages_total, 0),
  substantive: measures.reduce((n, m) => n + m.substantive_replies, 0),
  hollow: measures.reduce((n, m) => n + m.hollow_replies, 0),
  unclear: measures.reduce((n, m) => n + m.unclear_replies, 0),
  unclassified: measures.reduce((n, m) => n + m.unclassified_replies, 0),
  unmeasured: measures.filter((m) => m.substantive_reply_ratio === null).length,
};

const indexBody = `
<p>Each row is a discussion thread. The columns are a <strong>vector of separate
measures</strong>, deliberately not combined into a score — a single number would
invite an argument about weights that cannot be won, and one disputed input would
contaminate every column instead of one.</p>

<p><strong>“With standing”</strong> counts participants who hold community-conferred
standing under the <a href="methodology.html">published seed rule</a> — a count,
never a list, and not a judgement about anyone's contribution. <strong>“New
share”</strong> is described and never ranked: on a list only weeks old it is near 1
everywhere and carries almost no information, which is why it is shown rather than
hidden.</p>

<h2>Corpus</h2>
<dl class="facts">
  <dt>Threads</dt><dd>${totals.threads}</dd>
  <dt>Messages in threads</dt><dd>${totals.messages}</dd>
  <dt>Replies judged substantive</dt><dd>${totals.substantive}</dd>
  <dt>Replies judged hollow</dt><dd>${totals.hollow}</dd>
  <dt>Model declined to judge</dt><dd>${totals.unclear}</dd>
  <dt>Replies not yet classified</dt><dd>${totals.unclassified}</dd>
  <dt>Threads with no substance measure</dt><dd>${totals.unmeasured}</dd>
</dl>

<h2>Threads</h2>
<div class="scroll">
<table>
  <caption>Sorted by message count. Never sorted by any quality measure.</caption>
  <thead><tr>
    <th>Thread</th>
    ${measureColumns.map(([, label]) => `<th class="num">${label}</th>`).join("")}
    <th class="num">Substantive</th>
    <th class="num">Quoting</th>
    <th class="num">New share</th>
    <th class="num">Unclassified</th>
  </tr></thead>
  <tbody>
${threadRows || '<tr><td colspan="11"><span class="nodata">No measures recorded yet.</span></td></tr>'}
  </tbody>
</table>
</div>

${structure ? communitySection(structure) : ""}
`;

function communitySection(s: Record<string, any>): string {
  const rows = (s.communities as Record<string, number | boolean>[])
    .map(
      (c) =>
        `<tr>${numberCell(Number(c.size))}${numberCell(Number(c.internal_edges))}` +
        `${numberCell(Number(c.external_edges))}${ratioCell(Number(c.external_edge_ratio))}` +
        `<td>${c.contains_seed_member ? "yes" : "no"}</td>${numberCell(Number(c.max_core_number))}</tr>`,
    )
    .join("\n");
  return `
<h2>Group structure</h2>
<p>Communities in the reply graph, found by Louvain. A community with no member
holding community-conferred standing <em>and</em> a low external-edge ratio is a
group that mostly replies to itself and does not connect to the rest of the list.
That is a statement about a subgraph — not about the good faith of anyone in it,
and not about how anything was written.</p>
<dl class="facts">
  <dt>Accounts</dt><dd>${s.accounts.total}</dd>
  <dt>With community-conferred standing</dt><dd>${s.accounts.seeded}</dd>
  <dt>No datatracker record</dt><dd>${s.accounts.no_datatracker_record}</dd>
  <dt>Has a record, no clause matched</dt><dd>${s.accounts.resolved_but_unseeded}</dd>
  <dt>Modularity</dt><dd>${Number(s.modularity).toFixed(3)}</dd>
</dl>
<div class="scroll">
<table>
  <caption>Communities are numbered by size. No account is named.</caption>
  <thead><tr><th class="num">Size</th><th class="num">Internal edges</th>
  <th class="num">External edges</th><th class="num">External ratio</th>
  <th>Has member with standing</th><th class="num">Max core</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</div>`;
}

// --------------------------------------------------------------- accuracy --

const byOrigin = new Map<string, typeof forecasts>();
for (const f of forecasts) {
  byOrigin.set(f.origin_at, [...(byOrigin.get(f.origin_at) ?? []), f]);
}

/**
 * Per horizon and forecaster: how often the correlation was even defined, its
 * median, and how often it beat the baseline. 105 raw rows bury the finding;
 * this is the finding.
 */
type Summary = {
  horizon: number;
  forecaster: string;
  isBaseline: boolean;
  runs: number;
  defined: number;
  median: number | null;
  beatsBaseline: number;
};

const summaries: Summary[] = [];
for (const horizon of [...new Set(forecasts.map((f) => f.horizon_days))].sort((a, b) => a - b)) {
  const atHorizon = forecasts.filter((f) => f.horizon_days === horizon);
  const baselineAt = new Map(
    atHorizon.filter((f) => f.is_baseline).map((f) => [f.origin_at, f]),
  );
  for (const forecaster of [...new Set(atHorizon.map((f) => f.forecaster))]) {
    const runs = atHorizon.filter((f) => f.forecaster === forecaster);
    const defined = runs.map((r) => r.spearman).filter((s): s is number => s !== null).sort((a, b) => a - b);
    const beats = runs.filter((r) => {
      const peer = baselineAt.get(r.origin_at);
      return !r.is_baseline && r.spearman !== null && peer?.spearman != null && r.spearman > peer.spearman;
    }).length;
    summaries.push({
      horizon,
      forecaster,
      isBaseline: runs[0]?.is_baseline ?? false,
      runs: runs.length,
      defined: defined.length,
      median: defined.length ? defined[Math.floor(defined.length / 2)]! : null,
      beatsBaseline: beats,
    });
  }
}

const summaryRows = summaries
  .map(
    (s) =>
      `<tr><td class="num">${s.horizon}d</td>` +
      `<td><code>${escapeHtml(s.forecaster)}</code>${s.isBaseline ? " <em>(baseline)</em>" : ""}</td>` +
      numberCell(s.runs) +
      numberCell(s.defined) +
      `<td class="num">${s.median === null ? '<span class="nodata">undefined</span>' : (s.median >= 0 ? "+" : "") + s.median.toFixed(3)}</td>` +
      `<td class="num">${s.isBaseline ? '<span class="nodata">—</span>' : s.beatsBaseline}</td></tr>`,
  )
  .join("\n");

const accuracyRows = [...byOrigin]
  .sort()
  .flatMap(([origin, group]) => {
    const baseline = group.find((g) => g.is_baseline);
    return group.map((f) => {
      const beats =
        !f.is_baseline && f.spearman !== null && baseline?.spearman != null
          ? f.spearman > baseline.spearman
            ? "yes"
            : "no"
          : "—";
      return (
        `<tr><td>${escapeHtml(origin.slice(0, 10))}</td>` +
        `<td><code>${escapeHtml(f.forecaster)}</code>${f.is_baseline ? " <em>(baseline)</em>" : ""}</td>` +
        numberCell(f.threads_scored) +
        numberCell(f.threads_with_engagement) +
        `<td class="num">${f.spearman === null ? '<span class="nodata">undefined</span>' : f.spearman.toFixed(3)}</td>` +
        `<td class="num">${f.p_value === null ? '<span class="nodata">—</span>' : f.p_value.toFixed(3)}</td>` +
        `<td class="num">${f.precision_at_3 === null ? '<span class="nodata">—</span>' : f.precision_at_3.toFixed(2)}</td>` +
        `<td>${beats}</td></tr>`
      );
    });
  })
  .join("\n");

const accuracyBody = `
<p>This system scores threads at time <em>T</em> and checks at <em>T+7d</em>
whether the engagement it ranked highest actually materialised. An experimental
system that shows its own hit rate is worth reading; a confident unvalidated score
is not.</p>

<p>The <strong>baseline</strong> is raw reply volume — no model, no seed. The
question is never “does this predict anything” but “does it predict better than
counting messages”. Where a forecaster does not beat the baseline, the table says
so.</p>

<p>A rank correlation shows as <em>undefined</em> rather than as a number whenever
a predictor is constant across every thread, which happens routinely on a corpus
this small. That is a real limitation of the data, not a rendering gap.</p>

<h2>Summary</h2>
<div class="scroll">
<table>
  <caption>Median across origins. Origins roll daily, so successive windows overlap and these runs are correlated — they are not independent trials.</caption>
  <thead><tr><th class="num">Horizon</th><th>Forecaster</th><th class="num">Origins</th>
  <th class="num">Correlation defined</th><th class="num">Median Spearman</th>
  <th class="num">Beats baseline</th></tr></thead>
  <tbody>
${summaryRows || '<tr><td colspan="6"><span class="nodata">No evaluations recorded yet.</span></td></tr>'}
  </tbody>
</table>
</div>

<h2>Every evaluation</h2>
<div class="scroll">
<table>
  <caption>One row per origin per forecaster. Method: <a href="https://github.com/OR13/laocoon/blob/main/docs/holdout.md">docs/holdout.md</a>.</caption>
  <thead><tr><th>Origin</th><th>Forecaster</th><th class="num">Threads</th>
  <th class="num">With engagement</th><th class="num">Spearman</th><th class="num">p</th>
  <th class="num">Prec@3</th><th>Beats baseline</th></tr></thead>
  <tbody>
${accuracyRows || '<tr><td colspan="8"><span class="nodata">No evaluations recorded yet.</span></td></tr>'}
  </tbody>
</table>
</div>
`;

// ------------------------------------------------------------ methodology --

const provenance = measures[0]?.provenance;
const methodologyBody = `
<h2>What is measured</h2>
<p>Reception and graph position. Content that draws substantive replies from
centrally-connected accounts is engaged with; content whose only engagement comes
from an isolated peripheral cluster is not. Both are read off the reply graph.</p>

<h2>What is not measured, ever</h2>
<p><strong>Provenance.</strong> This system does not detect AI-generated text and
never forms, stores, or publishes the claim that an account or message is
machine-generated. Detection is unreliable, and a participant using a model well
can produce a genuinely valuable contribution. The classifier prompt explicitly
instructs the model not to speculate about how a message was produced.</p>

<p>Also excluded, and why: <strong>employer, affiliation and domain reputation</strong>
— suggestive privately and defamatory publicly, and a legitimate newcomer with a
personal domain looks identical to a fabricated one.
<strong>External SDO and academic credentials</strong> — they can only be joined on
a name, and a name join is trivially claimable, which would <em>create</em> the
credibility-faking attack this project exists to resist.</p>

<h2>Reply graph</h2>
<p>Edges come only from <code>In-Reply-To</code> and <code>References</code>.
Subject-line threading is deliberately not implemented: it manufactures edges the
corpus does not contain. Messages with no threading headers are reported as a
count and left unattached.</p>

<h2>The seed rule</h2>
<p>Reputation propagation starts from <strong>community-conferred</strong> standing
only: working group chairs past and present, area directors, IAB and IESG members,
authors of RFCs, and authors of adopted <code>draft-ietf-*</code> documents.
Submitting an individual draft does <strong>not</strong> count — that is standing a
participant conferred on themselves, and admitting it would make the seed forgeable.
The rule is published in full at
<a href="https://github.com/OR13/laocoon/blob/main/docs/seed-rule.md">docs/seed-rule.md</a>
and is recomputed, never hand-maintained.</p>

<p>Membership of the seed is <em>not</em> published: it is a label attached to
identifiable people. That costs nothing in contestability — the rule is public and
the datatracker is public, so anyone can recompute the membership and disagree.</p>

<h2>Substance classification</h2>
<p>Every reply is judged against the message it answers by a local model, asking
one question: does this reply address something specific in its parent? Length is
not the criterion. Per-message verdicts are private, because a per-message quality
label joined to a sender is a per-person quality score. Only the per-thread ratio
is published.</p>
${
  provenance
    ? `<dl class="facts">
  <dt>Reference model</dt><dd><code>${escapeHtml(provenance.classifier_model)}</code></dd>
  <dt>Prompt version</dt><dd>${escapeHtml(provenance.prompt_version)}</dd>
  <dt>Prompt hash</dt><dd><code>${escapeHtml(provenance.prompt_hash.slice(0, 23))}…</code></dd>
  <dt>Seed rule version</dt><dd>${escapeHtml(provenance.seed_rule_version)}</dd>
</dl>`
    : ""
}
<p>Two models are run. Where they disagree, the case is <strong>flagged for review
rather than resolved</strong>: choosing a winner would manufacture confidence out of
two models that do not agree.</p>

<h2>Fairness commitments</h2>
<ul>
  <li>Accounts are bucketed as new participant versus established, and new
  participants are <strong>described, never ranked</strong>. Age plus history
  structurally punishes newcomers, and the IETF depends on them.</li>
  <li>Every signal used is one a participant can verify and contest.</li>
  <li>“No datatracker record” is reported as a fact about a lookup, never as an
  inference about why.</li>
  <li>Per-person quality scores and ranked participant lists are never published.</li>
</ul>

<h2>Corrections</h2>
<p>Every figure derives from a JSON event committed to the repository. A dispute is
a GitHub issue against that file. Events are immutable: a correction is a
compensating event, never an edit.</p>

<h2>Coverage</h2>
<div class="scroll">
<table>
  <caption>Every crawl window recorded, so gaps are visible rather than inferred.</caption>
  <thead><tr><th>List</th><th>Mode</th><th>Completed</th><th class="num">In mailbox</th>
  <th class="num">UIDs examined</th><th class="num">Failures</th></tr></thead>
  <tbody>
${
  windows
    .slice(-10)
    .map(
      (w) =>
        `<tr><td>${escapeHtml(w.list_name)}</td><td>${escapeHtml(w.mode)}</td>` +
        `<td>${escapeHtml(w.completed_at.slice(0, 19))}Z</td>` +
        numberCell(w.mailbox_total) +
        numberCell(w.uids_examined) +
        numberCell(w.failures.length) +
        `</tr>`,
    )
    .join("\n") || '<tr><td colspan="6"><span class="nodata">No crawl recorded.</span></td></tr>'
}
  </tbody>
</table>
</div>
`;

// ------------------------------------------------------------------ write --

await rm(SITE_DIR, { recursive: true, force: true });
await mkdir(join(SITE_DIR, "data"), { recursive: true });

const pages: [string, string][] = [
  [
    "index.html",
    page({
      title: "Thread health",
      lede: "Which discussions have engagement, and which have volume.",
      active: "index.html",
      body: indexBody,
      generatedAt,
      coverageNote,
    }),
  ],
  [
    "accuracy.html",
    page({
      title: "Accuracy",
      lede: "How well this system's rankings predicted what happened next.",
      active: "accuracy.html",
      body: accuracyBody,
      generatedAt,
      coverageNote,
    }),
  ],
  [
    "methodology.html",
    page({
      title: "Methodology",
      lede: "What is measured, what is excluded, and why.",
      active: "methodology.html",
      body: methodologyBody,
      generatedAt,
      coverageNote,
    }),
  ],
];

const data: [string, unknown][] = [
  ["data/threads.json", measures],
  ["data/accuracy.json", forecasts],
  ["data/coverage.json", windows],
];
if (structure) data.push(["data/community-structure.json", structure]);

// The prompt hash is a sha256 of a prompt, not of a sender. Everything else
// matching the pattern is a leak.
const allowed = [PROMPT_HASH, ...measures.map((m) => m.provenance.prompt_hash)];

for (const [name, html] of pages) {
  assertNoSenderHash(name, html, allowed);
  await Bun.write(join(SITE_DIR, name), html);
}
for (const [name, value] of data) {
  const json = JSON.stringify(value, null, 2) + "\n";
  assertNoSenderHash(name, json, allowed);
  await Bun.write(join(SITE_DIR, name), json);
}

console.log(
  JSON.stringify(
    {
      out: SITE_DIR,
      pages: pages.map(([n]) => n),
      data: data.map(([n]) => n),
      threads: measures.length,
      forecast_evaluations: forecasts.length,
      crawl_windows: windows.length,
      community_structure: structure !== null,
    },
    null,
    2,
  ),
);
console.log(
  `\nNo sender hash in any output. Not deployed: publishing is the operator's decision.`,
);
