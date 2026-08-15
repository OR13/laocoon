import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { Num } from "@/components/measure-cell";
import { loadPublic, type Forecast } from "@/lib/data";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function signed(value: number | null) {
  if (value === null) return <span className="text-muted-foreground italic">undefined</span>;
  return <span className="tnum">{value >= 0 ? "+" : ""}{value.toFixed(3)}</span>;
}

export default async function AccuracyPage() {
  const { forecasts, windows } = await loadPublic();
  const last = windows[windows.length - 1];

  const horizons = [...new Set(forecasts.map((f) => f.horizon_days))].sort((a, b) => a - b);
  const summary = horizons.flatMap((horizon) => {
    const at = forecasts.filter((f) => f.horizon_days === horizon);
    const baseline = new Map(at.filter((f) => f.is_baseline).map((f) => [f.origin_at, f]));
    return [...new Set(at.map((f) => f.forecaster))].map((forecaster) => {
      const runs = at.filter((f) => f.forecaster === forecaster);
      const defined = runs.map((r) => r.spearman).filter((s): s is number => s !== null);
      const beats = runs.filter((r) => {
        const peer = baseline.get(r.origin_at);
        return !r.is_baseline && r.spearman !== null && peer?.spearman != null &&
          r.spearman > peer.spearman;
      }).length;
      return {
        horizon, forecaster,
        isBaseline: runs[0]?.is_baseline ?? false,
        origins: runs.length, defined: defined.length,
        median: median(defined), beats,
      };
    });
  });

  const byOrigin = new Map<string, Forecast[]>();
  for (const f of forecasts) byOrigin.set(f.origin_at, [...(byOrigin.get(f.origin_at) ?? []), f]);

  return (
    <SiteShell
      title="LAOCOÖN — accuracy"
      lede="How well this system's rankings predicted what happened next."
      active="/accuracy/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={
        <p>
          {last
            ? `Coverage: ${last.list_name}, ${last.mailbox_total} messages as of ${last.completed_at}.`
            : "No crawl window recorded."}
        </p>
      }
    >
      <p className="text-muted-foreground max-w-[72ch] text-sm">
        This system scores threads at time <em>T</em> and checks at <em>T+h</em> whether
        the engagement it ranked highest actually materialised. An experimental system
        that shows its own hit rate is worth reading; a confident unvalidated score is
        not. The <strong>baseline</strong> is raw reply volume — no model, no seed. The
        question is never &ldquo;does this predict anything&rdquo; but &ldquo;does it
        predict better than counting messages&rdquo;.
      </p>
      <p className="text-muted-foreground mt-2 max-w-[72ch] text-sm">
        A rank correlation shows as <em>undefined</em> rather than as a number whenever a
        predictor is constant across every thread, which happens routinely on a corpus
        this small. Origins roll daily, so successive windows overlap and these runs are
        correlated — they are not independent trials.
      </p>

      <h2 className="mt-8 mb-3 border-b pb-1 text-lg font-semibold">Summary</h2>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
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
              <TableRow key={`${s.horizon}-${s.forecaster}`}>
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
                <TableCell colSpan={6} className="text-muted-foreground italic">
                  No evaluations recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <h2 className="mt-10 mb-3 border-b pb-1 text-lg font-semibold">Every evaluation</h2>
      <div className="max-h-[34rem] overflow-auto rounded-lg border">
        <Table>
          <TableCaption className="px-3 py-2 text-left">
            One row per origin per forecaster.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Origin</TableHead>
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
            {[...byOrigin].sort().flatMap(([origin, group]) => {
              const baseline = group.find((g) => g.is_baseline);
              return group.map((f) => (
                <TableRow key={`${origin}-${f.horizon_days}-${f.forecaster}`}>
                  <TableCell>{origin.slice(0, 10)}</TableCell>
                  <TableCell className="tnum text-right">{f.horizon_days}d</TableCell>
                  <TableCell>
                    <code className="text-xs">{f.forecaster}</code>
                    {f.is_baseline && <span className="text-muted-foreground ml-1 text-xs">(baseline)</span>}
                  </TableCell>
                  <TableCell className="text-right"><Num value={f.threads_scored} /></TableCell>
                  <TableCell className="text-right"><Num value={f.threads_with_engagement} /></TableCell>
                  <TableCell className="text-right">{signed(f.spearman)}</TableCell>
                  <TableCell className="text-right"><Num value={f.p_value} digits={3} /></TableCell>
                  <TableCell className="text-right"><Num value={f.precision_at_3} digits={2} /></TableCell>
                  <TableCell>
                    {f.is_baseline || f.spearman === null || baseline?.spearman == null
                      ? <span className="text-muted-foreground">—</span>
                      : f.spearman > baseline.spearman ? "yes" : "no"}
                  </TableCell>
                </TableRow>
              ));
            })}
          </TableBody>
        </Table>
      </div>
    </SiteShell>
  );
}
