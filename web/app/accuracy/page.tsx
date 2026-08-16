import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { Num } from "@/components/measure-cell";
import { coverageLine, loadPublic } from "@/lib/data";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function signed(value: number | null) {
  if (value === null) return <span className="text-muted-foreground italic">undefined</span>;
  return <span className="tnum">{value >= 0 ? "+" : ""}{value.toFixed(3)}</span>;
}

/** Rows in the evaluation log. The full log is 1,537 rows and most of it is
 *  origins too early to score; the page shows the recent, scorable end. */
const LOG_ROWS = 60;

export default async function AccuracyPage() {
  const { forecasts, windows } = await loadPublic();

  // A baseline belongs to one list at one origin and one horizon. Keying on
  // origin alone scored a forecaster on one list against the other list's
  // baseline, and 179 origins occur on both lists.
  const key = (f: { list_name?: string; origin_at: string; horizon_days: number }) =>
    `${f.list_name ?? ""} ${f.origin_at} ${f.horizon_days}`;

  // 761 of the recorded evaluations predate `list_name` on the event. Events
  // here are immutable and the list those ran against is not recoverable, so
  // they are counted and then left out of every per-list figure rather than
  // pooled into one of them.
  const attributed = forecasts.filter((f) => f.list_name);
  const legacy = forecasts.length - attributed.length;

  const baselineAt = new Map(attributed.filter((f) => f.is_baseline).map((f) => [key(f), f]));
  const lists = [...new Set(attributed.map((f) => f.list_name!))].sort();
  const horizons = [...new Set(attributed.map((f) => f.horizon_days))].sort((a, b) => a - b);

  const summary = lists.flatMap((list) =>
    horizons.flatMap((horizon) => {
      const at = attributed.filter((f) => f.list_name === list && f.horizon_days === horizon);
      return [...new Set(at.map((f) => f.forecaster))].map((forecaster) => {
        const runs = at.filter((f) => f.forecaster === forecaster);
        const defined = runs.map((r) => r.spearman).filter((s): s is number => s !== null);
        const beats = runs.filter((r) => {
          const peer = baselineAt.get(key(r));
          return (
            !r.is_baseline && r.spearman !== null && peer?.spearman != null &&
            r.spearman > peer.spearman
          );
        }).length;
        return {
          list, horizon, forecaster,
          isBaseline: runs[0]?.is_baseline ?? false,
          origins: runs.length,
          defined: defined.length,
          median: median(defined),
          beats,
        };
      });
    }),
  ).filter((row) => row.origins > 0);

  // Newest first, and only rows where the correlation is defined: an origin
  // with two threads and no engagement is not evidence of anything, and
  // hundreds of them at the top of the table hid the rows that are.
  const scorable = attributed.filter((f) => f.spearman !== null);
  const log = scorable.slice(0, LOG_ROWS);

  return (
    <SiteShell
      title="LAOCOÖN — accuracy"
      lede="How well this system's rankings predicted what happened next."
      active="/accuracy/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={<p>{coverageLine(windows)}</p>}
    >
      <p className="text-muted-foreground max-w-[72ch] text-sm">
        This system scores threads at time <em>T</em> and checks at <em>T+h</em> whether
        the engagement it ranked highest actually materialised. The{" "}
        <strong>baseline</strong> is raw reply volume — no model, no seed. The question is
        never &ldquo;does this predict anything&rdquo; but &ldquo;does it predict better
        than counting messages&rdquo;.
      </p>
      <p className="text-muted-foreground mt-2 max-w-[72ch] text-sm">
        Each list is scored against its own baseline. Origins roll daily, so successive
        windows overlap and these runs are correlated — they are not independent trials.
        {legacy > 0 && (
          <>
            {" "}
            <strong>{legacy}</strong> of {forecasts.length} recorded evaluations predate
            the list being written onto the event. Events here are immutable and the list
            is not recoverable, so those runs are left out of everything below rather than
            attributed to a guess.
          </>
        )}
      </p>

      <h2 className="mt-8 mb-3 border-b pb-1 text-lg font-semibold">Summary</h2>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>List</TableHead>
              <TableHead className="text-right">Horizon</TableHead>
              <TableHead>Forecaster</TableHead>
              <TableHead className="text-right">Origins</TableHead>
              <TableHead className="text-right">Correlation defined</TableHead>
              <TableHead className="text-right">Median Spearman</TableHead>
              <TableHead className="text-right">Beats baseline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.map((s) => (
              <TableRow key={`${s.list}-${s.horizon}-${s.forecaster}`}>
                <TableCell className="text-xs">{s.list}</TableCell>
                <TableCell className="tnum text-right">{s.horizon}d</TableCell>
                <TableCell>
                  <code className="text-xs">{s.forecaster}</code>
                  {s.isBaseline && <Badge variant="secondary" className="ml-2">baseline</Badge>}
                </TableCell>
                <TableCell className="text-right"><Num value={s.origins} /></TableCell>
                <TableCell className="text-right"><Num value={s.defined} /></TableCell>
                <TableCell className="text-right">{signed(s.median)}</TableCell>
                <TableCell className="text-right">
                  {s.isBaseline ? <span className="text-muted-foreground">—</span> : <Num value={s.beats} />}
                </TableCell>
              </TableRow>
            ))}
            {summary.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground italic">
                  No evaluations recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground mt-2 max-w-[72ch] text-xs">
        A rank correlation is <em>undefined</em> whenever a predictor is constant across
        every thread in the window, which happens routinely on a corpus this small.{" "}
        <strong>Correlation defined</strong> is how many of an entry&apos;s origins
        produced a number at all, and the median is over those.
      </p>

      <h2 className="mt-10 mb-2 border-b pb-1 text-lg font-semibold">Evaluation log</h2>
      <p className="text-muted-foreground mb-3 max-w-[72ch] text-sm">
        The {scorable.length} evaluations that produced a correlation, newest first
        {scorable.length > LOG_ROWS && ` — showing the most recent ${LOG_ROWS}`}. A further{" "}
        {forecasts.length - scorable.length} ran against windows too small or too quiet to
        score; they are in the event log, and are counted in <em>Origins</em> above.
      </p>
      <div className="max-h-[34rem] overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Origin</TableHead>
              <TableHead>List</TableHead>
              <TableHead className="text-right">Horizon</TableHead>
              <TableHead>Forecaster</TableHead>
              <TableHead className="text-right">Threads</TableHead>
              <TableHead className="text-right">With engagement</TableHead>
              <TableHead className="text-right">Spearman</TableHead>
              <TableHead className="text-right">p</TableHead>
              <TableHead className="text-right">Prec@3</TableHead>
              <TableHead>Beats baseline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {log.map((f) => {
              const baseline = baselineAt.get(key(f));
              return (
                <TableRow key={`${f.list_name}-${f.origin_at}-${f.horizon_days}-${f.forecaster}`}>
                  <TableCell className="tnum">{f.origin_at.slice(0, 10)}</TableCell>
                  <TableCell className="text-xs">{f.list_name}</TableCell>
                  <TableCell className="tnum text-right">{f.horizon_days}d</TableCell>
                  <TableCell>
                    <code className="text-xs">{f.forecaster}</code>
                    {f.is_baseline && (
                      <span className="text-muted-foreground ml-1 text-xs">(baseline)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right"><Num value={f.threads_scored} /></TableCell>
                  <TableCell className="text-right"><Num value={f.threads_with_engagement} /></TableCell>
                  <TableCell className="text-right">{signed(f.spearman)}</TableCell>
                  <TableCell className="text-right"><Num value={f.p_value} digits={3} /></TableCell>
                  <TableCell className="text-right"><Num value={f.precision_at_3} digits={2} /></TableCell>
                  <TableCell>
                    {f.is_baseline || f.spearman === null || baseline?.spearman == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : f.spearman > baseline.spearman ? (
                      "yes"
                    ) : (
                      "no"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </SiteShell>
  );
}
