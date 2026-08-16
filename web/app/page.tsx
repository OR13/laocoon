import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { TimeRangeProvider } from "@/components/time-range";
import { Dashboard } from "@/components/dashboard";
import { Explorer } from "@/components/explorer";
import type { GraphSource } from "@/lib/graph-model";
import { archiveListUrl, archiveMessageUrl } from "@/lib/archive";
import { coverageLine, loadPublic, loadReview } from "@/lib/data";
import { ReviewPanel } from "@/components/review-panel";
import { ContributionCard } from "@/components/contribution-card";
import { LanguageCard } from "@/components/language-card";

export default async function OverviewPage() {
  const { activity, windows, structure, forecasts, measures, trees, health, contribution, language } =
    await loadPublic();
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
  // The larger corpus leads the headline figure: a share over 106 messages and
  // a share over 1,233 are not the same kind of number.
  const biggestList = [...language].sort(
    (a, b) => b.distribution.messages - a.distribution.messages,
  )[0];

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
            list_name: topic.list_name,
            label: topic.label ? `${topic.label}` : null,
            median_novelty: vals.length ? vals[Math.floor(vals.length / 2)]! : null,
          };
        }),
        threads: allThreads.map((th) => ({
          id: th.id,
          topic_id: topicOfThread.get(th.id) ?? null,
          subject: th.subject,
          list_name: th.list_name,
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
          <p>{coverageLine(windows)}</p>
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
              <CardTitle className="text-base">Topics</CardTitle>
              <CardDescription>
                {tree ? (
                  <>
                    <strong>Click a topic</strong> to open it into its threads, then a
                    thread for its opening line and a link into the{" "}
                    <a
                      className="text-primary underline"
                      href={archiveListUrl(tree.list_name)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      mail archive
                    </a>
                    . Follows the lookback window above — {allTopics.length} topics
                    across {allThreads.length} threads over the whole corpus. How the
                    threshold was chosen, and why{" "}
                    {trees.filter((tr) => tr.topics.length === 0).map((tr) => tr.list_name).join(", ") ||
                      "a list"}{" "}
                    contributes no topics:{" "}
                    <a className="text-primary underline" href="/methodology/">
                      methodology
                    </a>
                    .
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

      <ContributionCard data={contribution} />
      <LanguageCard data={language} />

      {health.length > 0 && (
        <Card className="mt-6" data-review="axes">
          <CardHeader>
            <CardTitle className="text-base">Thread measures — per list</CardTitle>
            <CardDescription>
              Three axes, each measured independently and shown as a spread rather than
              combined. Per list, never pooled.
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
              It called threads open, narrow or closed, and on the holdout it inverted:
              the ones it called closed were the most likely to continue, 80% against 7.7%
              on agentproto. The axes are measurements and are kept; the verdict on top of
              them was wrong.
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
            <CardTitle className="text-base">Interchangeable messages</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 text-sm">
            <p className="text-foreground tnum text-2xl font-semibold">
              {biggestList
                ? `${Math.round(biggestList.distribution.not_more_like_own_thread * 100)}%`
                : "not measured"}
            </p>
            <p>
              {biggestList ? (
                <>
                  Of {biggestList.distribution.messages} messages on{" "}
                  {biggestList.list_name}, that share sits no closer in vocabulary to its
                  own thread than to the rest of the list. A local model asked the same
                  question answered &ldquo;no&rdquo; for every message on both lists, so
                  it is computed instead.
                </>
              ) : (
                <>Run <code>bun run concreteness</code> to measure this.</>
              )}
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
