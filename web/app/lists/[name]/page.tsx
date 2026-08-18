import { notFound } from "next/navigation";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { LevelBar, LevelChip, plural, Stats } from "@/components/entity";
import { ScoreTrend } from "@/components/score-trend";
import { coverageLine, loadPublic } from "@/lib/data";
import { tidySubject } from "@/lib/graph-model";
import { contributorLevel, CONTRIBUTOR_HELP, LEVEL_META, UTILITY_HELP } from "@/lib/scores";
import { withBase } from "@/lib/base";

/** One page per mailing list: the top of the hierarchy. */
export async function generateStaticParams() {
  const { network } = await loadPublic();
  return (network?.mailing_lists ?? []).map((l) => ({ name: l.name }));
}

export default async function ListPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { network, windows } = await loadPublic();
  const list = network?.mailing_lists.find((l) => l.name === name);
  if (!list || !network) notFound();

  const threads = network.threads
    .filter((t) => t.list_name === name)
    .sort((a, b) => b.messages - a.messages);
  const topics = network.topics
    .filter((t) => t.lists.includes(name))
    .sort((a, b) => b.messages - a.messages);
  const people = network.nodes
    .filter((p) => p.lists.includes(name))
    .sort((a, b) => b.messages - a.messages || b.score - a.score);

  const listDaily = (network.daily ?? []).filter((d) => d.list_name === name);

  const span =
    list.first_message_at && list.last_message_at
      ? `${list.first_message_at.slice(0, 10)} to ${list.last_message_at.slice(0, 10)}`
      : "no dated messages";

  return (
    <SiteShell
      title={list.name}
      lede={`An IETF mailing list, crawled from ${span}.`}
      active="/lists/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={<p>{coverageLine(windows)}</p>}
    >
      <p className="mb-6">
        <a
          className="text-primary text-sm hover:underline"
          href={list.archive_url}
          target="_blank"
          rel="noreferrer"
        >
          Browse in the IETF mail archive ↗
        </a>
      </p>

      <Stats
        items={[
          ["Messages", String(list.messages)],
          ["Threads", String(list.threads)],
          ["People", String(list.participants)],
          [
            "Topics",
            list.topics_refused
              ? { withheld: list.topics_refused, as: "refused" }
              : String(list.topics),
          ],
        ]}
      />

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-base font-semibold">Thread utility</h2>
          <p className="text-muted-foreground mt-0.5 mb-3 text-xs">
            How the {plural(list.threads, "thread")} on this list were carried.
          </p>
          <LevelBar counts={list.utility} help={UTILITY_HELP} />
        </section>
        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-base font-semibold">Contributor record</h2>
          <p className="text-muted-foreground mt-0.5 mb-3 text-xs">
            What the {plural(list.participants, "person", "people")} posting here have published in the IETF.
          </p>
          <LevelBar counts={list.contributor} help={CONTRIBUTOR_HELP} />
        </section>
      </div>

      {listDaily.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-lg font-semibold">Messages per day</h2>
          <p className="text-muted-foreground mb-4 text-xs">
            Activity on {list.name} over the last 30 days. Left: contributor score of the sender. Right: utility score of the thread.
          </p>
          <ScoreTrend daily={listDaily} days={30} />
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-2 text-lg font-semibold">Topics</h2>
        {list.topics_refused ? (
          <div className="bg-card text-muted-foreground max-w-[76ch] rounded-lg border p-4 text-xs leading-relaxed">
            <strong className="text-foreground font-medium">Clustering refused:</strong>{" "}
            {list.topics_refused}{" "}
            <a className="text-primary underline" href={withBase("/methodology/#topics")}>
              How topic clustering is calibrated
            </a>
            .
          </div>
        ) : topics.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {topics.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <a className="hover:text-primary font-medium hover:underline" href={withBase(`/topics/${t.id}/`)}>
                  {t.label}
                </a>
                <span className="text-muted-foreground tnum text-xs">
                  {plural(t.threads.length, "thread")} · {plural(t.messages, "message")} ·{" "}
                  {plural(t.participants.length, "person", "people")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No topic clusters formed for this list.</p>
        )}
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h2 className="text-lg font-semibold">Threads</h2>
            <p className="text-muted-foreground text-xs">
              {plural(threads.length, "thread")}, ordered by message count.
            </p>
          </div>
        </div>
        <ul className="divide-y rounded-lg border">
          {threads.slice(0, 25).map((t) => (
            <li key={t.id} className="flex items-start gap-3 p-3">
              <span className="mt-[3px] shrink-0" title={UTILITY_HELP[t.utility]}>
                <LevelChip level={t.utility} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <a
                    className="hover:text-primary text-sm font-medium hover:underline"
                    href={withBase(`/threads/${t.slug}/`)}
                  >
                    {tidySubject(t.subject)}
                  </a>
                  {t.href && (
                    <a
                      href={t.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground text-xs"
                      title="Open in IETF archive"
                    >
                      ↗
                    </a>
                  )}
                </div>
                <div className="text-muted-foreground tnum mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  <span>{plural(t.messages, "message")}</span>
                  <span>·</span>
                  <span>{plural(t.participants.length, "person", "people")}</span>
                  <span>·</span>
                  <span>{Math.round(t.top_two_share * 100)}% from top two</span>
                  {t.quiet_for_days !== null && (
                    <>
                      <span>·</span>
                      <span>quiet {t.quiet_for_days}d</span>
                    </>
                  )}
                  {t.topic_label && (
                    <>
                      <span>·</span>
                      <span className="opacity-80">{t.topic_label}</span>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {threads.length > 25 && (
          <p className="text-muted-foreground mt-2 text-xs">and {threads.length - 25} more threads</p>
        )}
      </section>

      <section className="mt-10">
        <div className="mb-3">
          <h2 className="text-lg font-semibold">Participants</h2>
          <p className="text-muted-foreground text-xs">
            {plural(people.length, "person", "people")} who have posted to {list.name}, ordered by message count.
          </p>
        </div>
        <ul className="divide-y rounded-lg border">
          {people.slice(0, 25).map((p) => (
            <li key={p.id} className="flex items-center gap-3 p-3 text-sm">
              <LevelChip level={contributorLevel(p.score)} />
              <div className="min-w-0 flex-1">
                <a className="hover:text-primary font-medium hover:underline" href={withBase(`/people/${p.id}/`)}>
                  {p.name}
                </a>
              </div>
              <span className="text-muted-foreground tnum ml-auto text-xs">
                {plural(p.messages, "message")} · contributor {p.score}
                {p.rfcs > 0 && ` · ${plural(p.rfcs, "RFC")}`}
                {p.adopted_drafts > 0 && ` · ${plural(p.adopted_drafts, "adopted draft")}`}
                {p.chairs_now && " · WG chair"}
              </span>
            </li>
          ))}
        </ul>
        {people.length > 25 && (
          <p className="text-muted-foreground mt-2 text-xs">and {people.length - 25} more people</p>
        )}
      </section>
    </SiteShell>
  );
}

