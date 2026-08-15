/**
 * HTML rendering for the static site.
 *
 * Plain by intention. PROBLEM.md section 10 defers presentation and information
 * design until there is a working prototype and a real reader to test it
 * against; building an elaborate interface now would be designing for a use
 * nobody has had yet. What this has to get right is that the numbers are legible
 * and honestly qualified.
 *
 * Three rules the markup enforces:
 *
 *   * **No composite score.** Measures render as a vector of columns, side by
 *     side. Section 7 rules out a single number, because it invites an argument
 *     about weights that cannot be won.
 *   * **"Not measured" never renders as zero.** A thread nobody classified and a
 *     thread of hollow replies are different facts and get different cells.
 *   * **New participants are described, never ranked.** The column exists; the
 *     table is never sorted by it.
 */

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A ratio cell. Null renders as an explicit absence, never as 0. */
export function ratioCell(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return `<td class="ratio none" title="no data for this measure"><span class="nodata">not measured</span></td>`;
  }
  const pct = Math.round(value * 100);
  return (
    `<td class="ratio"><span class="bar" style="--fill:${pct}%"></span>` +
    `<span class="num">${pct}%</span></td>`
  );
}

export function numberCell(value: number, className = ""): string {
  const rendered = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `<td class="num${className ? " " + className : ""}">${escapeHtml(rendered)}</td>`;
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #16191d;
  --muted: #5b6470;
  --border: #dfe3e8;
  --surface: #f6f7f9;
  --accent: #1f5f8b;
  --fill: #9fc4dd;
  --warn: #8a5a00;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171a;
    --fg: #e8eaed;
    --muted: #9aa4b0;
    --border: #2b3138;
    --surface: #1b1f24;
    --accent: #7fb6da;
    --fill: #35566d;
    --warn: #d8a24a;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 1.25rem 4rem;
  background: var(--bg); color: var(--fg);
  font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
}
main { max-width: 68rem; margin: 0 auto; }
header { border-bottom: 1px solid var(--border); margin-bottom: 1.5rem; padding: 1.5rem 0 1rem; }
h1 { font-size: 1.5rem; margin: 0 0 .35rem; letter-spacing: -0.01em; }
h2 { font-size: 1.1rem; margin: 2rem 0 .6rem; }
h3 { font-size: .95rem; margin: 1.4rem 0 .4rem; }
p, li { max-width: 60ch; }
nav a { color: var(--accent); margin-right: 1rem; text-decoration: none; }
nav a:hover { text-decoration: underline; }
a { color: var(--accent); }
.lede { color: var(--muted); margin: 0; }
.banner {
  border: 1px solid var(--border); border-left: 3px solid var(--warn);
  background: var(--surface); padding: .7rem .9rem; margin: 1rem 0; border-radius: 4px;
}
.banner strong { color: var(--warn); }
.scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 4px; }
table { border-collapse: collapse; width: 100%; font-size: .875rem; }
caption { text-align: left; color: var(--muted); padding: .6rem .75rem; font-size: .8rem; }
th, td { padding: .45rem .6rem; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
thead th { background: var(--surface); font-weight: 600; position: sticky; top: 0; }
th.rot { font-weight: 600; }
td.subject { white-space: normal; min-width: 22rem; max-width: 34rem; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
td.ratio { position: relative; text-align: right; font-variant-numeric: tabular-nums; min-width: 6.5rem; }
td.ratio .bar {
  position: absolute; left: .35rem; top: 50%; transform: translateY(-50%);
  width: 3.2rem; height: .55rem; border-radius: 2px; background: var(--border);
  overflow: hidden;
}
td.ratio .bar::after {
  content: ""; display: block; height: 100%; width: var(--fill); background: var(--accent);
}
.nodata { color: var(--muted); font-style: italic; font-size: .8rem; }
tbody tr:nth-child(even) { background: color-mix(in oklab, var(--surface) 55%, transparent); }
dl.facts { display: grid; grid-template-columns: auto 1fr; gap: .25rem 1rem; margin: 0; }
dl.facts dt { color: var(--muted); }
dl.facts dd { margin: 0; font-variant-numeric: tabular-nums; }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: .85rem; }
code { background: var(--surface); padding: .1rem .3rem; border-radius: 3px; font-size: .85em; }
`;

export interface PageOptions {
  title: string;
  lede: string;
  active: string;
  body: string;
  generatedAt: string;
  coverageNote: string;
}

const NAV = [
  ["index.html", "Threads"],
  ["accuracy.html", "Accuracy"],
  ["methodology.html", "Methodology"],
];

export function page(options: PageOptions): string {
  const nav = NAV.map(([href, label]) =>
    href === options.active
      ? `<a href="${href}" aria-current="page"><strong>${label}</strong></a>`
      : `<a href="${href}">${label}</a>`,
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(options.title)} — LAOCOÖN</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
  <h1>LAOCOÖN — ${escapeHtml(options.title)}</h1>
  <p class="lede">${escapeHtml(options.lede)}</p>
  <nav>${nav}</nav>
</header>

<div class="banner">
  <strong>Experimental.</strong> A personal research project by Orie Steele. Not an
  IETF product, not a working group deliverable, and not a statement made in any
  chair capacity. Nothing here represents IETF consensus. It does
  <strong>not</strong> detect AI-generated text: provenance is out of scope and is
  never formed, stored, or published.
</div>

${options.body}

<footer>
  <p>Generated ${escapeHtml(options.generatedAt)}. ${escapeHtml(options.coverageNote)}</p>
  <p>Every figure here derives from an event committed to the
  <a href="https://github.com/OR13/laocoon">repository</a>. If one is wrong, open an
  issue against it. Per-person scores are not published and do not appear in this site.</p>
</footer>
</main>
</body>
</html>
`;
}
