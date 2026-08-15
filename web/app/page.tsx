import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { TimeRangeProvider } from "@/components/time-range";
import { Dashboard } from "@/components/dashboard";
import { ThreadGraph } from "@/components/thread-graph";
import { loadPublic } from "@/lib/data";

export default async function OverviewPage() {
  const { activity, windows, structure, forecasts, measures } = await loadPublic();
  const last = windows[windows.length - 1];

  const baseline7 = forecasts.filter((f) => f.horizon_days === 7 && f.is_baseline);
  const defined = baseline7.map((f) => f.spearman).filter((s): s is number => s !== null);
  const medianBaseline =
    defined.length > 0 ? [...defined].sort((a, b) => a - b)[Math.floor(defined.length / 2)]! : null;
  const unmeasured = measures.filter((m) => m.substantive_reply_ratio === null).length;

  return (
    <SiteShell
      title="LAOCOÖN"
      lede="What the list actually did this week — and whether volume is being mistaken for consensus."
      active="/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={
        <>
          <p>
            {last
              ? `Coverage: ${last.list_name}, ${last.mailbox_total} messages in the mailbox as of ${last.completed_at}, ${last.failures.length} fetch failures.`
              : "Coverage: no crawl window recorded."}
          </p>
          <p className="mt-1">
            Every figure derives from an event committed to the repository. If one is
            wrong, open an issue against it. Per-person scores are not published and do
            not appear on this site.
          </p>
        </>
      }
    >
      {activity ? (
        <TimeRangeProvider>
          <Dashboard activity={activity} />

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-base">Which discussions connect</CardTitle>
              <CardDescription>
                Threads active in the selected window. A link means the same people posted
                in both — so a thread with no links is a conversation nobody carried
                anywhere else.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ThreadGraph activity={activity} />
            </CardContent>
          </Card>
        </TimeRangeProvider>
      ) : (
        <p className="text-muted-foreground text-sm">
          No activity rollup yet — run <code>bun run activity</code>.
        </p>
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Does volume predict engagement?</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 text-sm">
            <p className="text-foreground tnum text-2xl font-semibold">
              {medianBaseline === null
                ? "not measured"
                : `${medianBaseline >= 0 ? "+" : ""}${medianBaseline.toFixed(3)}`}
            </p>
            <p>
              Median rank correlation between a thread&apos;s replies last week and its
              replies the week after.{" "}
              {medianBaseline !== null && medianBaseline < 0 && (
                <>
                  It is <strong>negative</strong>: a thread that was busy is, if anything,
                  less likely to stay busy. That is the failure mode this project exists to
                  catch, showing up as a measurement.
                </>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Substance measure</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 text-sm">
            <p className="text-foreground tnum text-2xl font-semibold">no variance</p>
            <p>
              The classifier judged {measures.reduce((n, m) => n + m.substantive_replies, 0)}{" "}
              replies substantive and{" "}
              {measures.reduce((n, m) => n + m.hollow_replies, 0)} hollow. A measure with no
              variance carries no information, so it currently adds nothing over counting
              replies. {unmeasured} threads have no substance measure at all.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Isolated clusters</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 text-sm">
            <p className="text-foreground tnum text-2xl font-semibold">
              {structure ? structure.communities_without_seed_member.count : "—"}
            </p>
            <p>
              Communities with no member holding community-conferred standing. On this
              corpus none of them is self-reinforcing — the pattern this project looks for
              is not present yet.
            </p>
          </CardContent>
        </Card>
      </div>
    </SiteShell>
  );
}
