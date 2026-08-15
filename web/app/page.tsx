import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { TimeRangeProvider } from "@/components/time-range";
import { Dashboard } from "@/components/dashboard";
import { Explorer } from "@/components/explorer";
import type { GraphSource } from "@/lib/graph-model";
import { archiveListUrl, archiveMessageUrl } from "@/lib/archive";
import { loadPublic, loadReview } from "@/lib/data";
import { ReviewPanel } from "@/components/review-panel";

export default async function OverviewPage() {
  const { activity, windows, structure, forecasts, measures, trees, health } = await loadPublic();
  const review = await loadReview();

  // The list with a usable topic partition leads. agentproto's 23 threads are
  // all about one charter, so its clustering is refused rather than forced —
  // showing an empty graph there would be worse than showing the list that has
  // structure.
  // Every list with a usable partition, in one graph. agentproto contributes no
  // topics — its 23 threads are one conversation about one charter and the blob
  // cap refuses to split them — so its threads appear only via its own tree.
  const usable = trees.filter((t) => t.topics.length > 0);
  const tree = usable[0] ?? trees[0] ?? null;

  const healthOf = new Map(health.flatMap((h) => h.threads.map((r) => [r.thread_id, r] as const)));
  const listOfThread = new Map<string, string>();
  const noveltyOf = new Map<string, number | null>();
  trees.forEach((tr) =>
    tr.threads.forEach((th) => {
      listOfThread.set(th.id, tr.list_name);
      noveltyOf.set(th.id, th.median_novelty);
    }),
  );

  const topicOfThread = new Map<string, string>();
  trees.forEach((tr) =>
    tr.topics.forEach((topic) => topic.threads.forEach((id) => topicOfThread.set(id, topic.id))),
  );
  const novelty = (id: string) => noveltyOf.get(id) ?? null;

  const last = windows[windows.length - 1];

  const baseline7 = forecasts.filter((f) => f.horizon_days === 7 && f.is_baseline);
  const defined = baseline7.map((f) => f.spearman).filter((s): s is number => s !== null);
  const medianBaseline =
    defined.length > 0 ? [...defined].sort((a, b) => a - b)[Math.floor(defined.length / 2)]! : null;
  const unmeasured = measures.filter((m) => m.substantive_reply_ratio === null).length;

  const allTopics = trees.flatMap((tr) =>
    tr.topics.map((topic) => ({ ...topic, list_name: tr.list_name })),
  );
  const allThreads = trees.flatMap((tr) =>
    tr.threads.map((th) => ({ ...th, list_name: tr.list_name })),
  );

  const graphSource: GraphSource | null = tree
    ? {
        topics: allTopics.map((topic) => {
          const vals = topic.threads
            .map(novelty)
            .filter((v): v is number => v !== null)
            .sort((a, b) => a - b);
          return {
            ...topic,
            label: topic.label ? `${topic.label}` : null,
            median_novelty: vals.length ? vals[Math.floor(vals.length / 2)]! : null,
          };
        }),
        threads: allThreads.map((th) => ({
          id: th.id,
          topic_id: topicOfThread.get(th.id) ?? null,
          subject: th.subject,
          gist: th.gist,
          href: archiveMessageUrl(th.id, th.list_name),
          message_count: th.message_count,
          distinct_senders: th.distinct_senders,
          last_message_at: th.last_message_at,
          median_novelty: th.median_novelty,
          reach: healthOf.get(th.id)?.reach,
          uptakeFromStanding: healthOf.get(th.id)?.uptake_from_standing,
        })),
        persons: [],
        participation: [],
        replies: [],
      }
    : null;

  return (
    <SiteShell
      title="LAOCOÖN"
      lede={`${
        activity ? activity.lists.join(" and ") : "The crawled lists"
      } together — what they did this week, and whether volume is being mistaken for consensus.`}
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
      {review?.pending && <ReviewPanel spec={review} />}

      {activity ? (
        <TimeRangeProvider>
          <Dashboard activity={activity} />

          <Card className="mt-6" data-review="topics">
            <CardHeader>
              <CardTitle className="text-base">Topics — all lists</CardTitle>
              <CardDescription>
                {tree ? (
                  <>
                    {allTopics.length} topics across {allThreads.length} threads from{" "}
                    {trees.length} lists, with{" "}
                    {trees.reduce((n, tr) => n + tr.unassigned_threads.length, 0)} left
                    unassigned rather than forced into one.{" "}
                    {trees.filter((tr) => tr.topics.length === 0).map((tr) => tr.list_name).join(", ") &&
                      `${trees.filter((tr) => tr.topics.length === 0).map((tr) => tr.list_name).join(", ")} contributes no topics: its threads are one conversation and the blob cap refuses to split them. `}
                    Clusters are laid out apart; click a topic to expand it into its
                    threads, then a thread for its opening line and a link into the{" "}
                    <a
                      className="text-primary underline"
                      href={archiveListUrl(tree.list_name)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      mail archive
                    </a>
                    . Threshold {tree.chosen_threshold} was chosen by held-out prediction
                    (ρ {tree.holdout_spearman}), beating subject matching (
                    {tree.calibration.subject_baseline_holdout}) and a single cluster (
                    {tree.calibration.single_cluster_holdout}).
                  </>
                ) : (
                  "No usable topic partition yet."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {graphSource ? (
                <Explorer source={graphSource} named={false} />
              ) : (
                <p className="text-muted-foreground text-sm">
                  No topic clustering yet — run <code>bun run topics</code>.
                </p>
              )}
            </CardContent>
          </Card>
        </TimeRangeProvider>
      ) : (
        <p className="text-muted-foreground text-sm">
          No activity rollup yet — run <code>bun run activity</code>.
        </p>
      )}

      {health.length > 0 && (
        <Card className="mt-6" data-review="axes">
          <CardHeader>
            <CardTitle className="text-base">Thread measures — per list</CardTitle>
            <CardDescription>
              Three axes, each measured independently and reported as a distribution
              rather than combined. Shown per list, never pooled: pooling is how a
              finding from a three-week-old list became a claim about the method.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-background">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-semibold">List</th>
                    <th className="px-3 py-2 text-right font-semibold">Threads</th>
                    <th className="px-3 py-2 text-right font-semibold">Reach</th>
                    <th className="px-3 py-2 text-right font-semibold">Uptake</th>
                    <th className="px-3 py-2 text-right font-semibold">Novelty</th>
                  </tr>
                </thead>
                <tbody>
                  {health.map((h) => (
                    <tr key={h.list_name} className="border-b">
                      <td className="px-3 py-2 font-medium">{h.list_name}</td>
                      <td className="tnum px-3 py-2 text-right">{h.threads_scored}</td>
                      {(["reach", "uptake_from_standing", "median_novelty"] as const).map((k) => (
                        <td key={k} className="tnum px-3 py-2 text-right">
                          {h.axes[k]?.median?.toFixed(2) ?? "—"}
                          <span className="text-muted-foreground ml-1 text-xs">
                            ({h.axes[k]?.p10?.toFixed(2) ?? "—"}–{h.axes[k]?.p90?.toFixed(2) ?? "—"})
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 rounded-md border border-l-[3px] border-l-[var(--warn)] bg-[var(--warn-bg)] p-3 text-xs">
              <strong className="text-[var(--warn)]">
                A health verdict was here and has been removed.
              </strong>{" "}
              An open/narrow/closed label built from these three axes was tested the way
              everything else here is tested — does it predict engagement over the next
              horizon — and it inverted. Threads it called &ldquo;closed&rdquo; were the
              most likely to continue: 80% against 7.7% on agentproto, 28.6% against 2.1%
              on agent2agent. Reach is an inverse proxy for a sustained argument. The
              axes are kept because they are measurements; the verdict on top of them was
              wrong.
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-3" data-review="findings">
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
