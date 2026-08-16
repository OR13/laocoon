import { notFound } from "next/navigation";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { LevelBar, LevelChip, plural, Stats } from "@/components/entity";
import { coverageLine, loadPublic } from "@/lib/data";
import { tidySubject } from "@/lib/graph-model";
import { contributorLevel, CONTRIBUTOR_HELP, UTILITY_HELP } from "@/lib/scores";

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
    .sort((a, b) => b.messages - a.messages);

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
          Browse it in the IETF archive ↗
        </a>
      </p>

      <Stats
        items={[
          ["Messages", String(list.messages)],
          ["Threads", String(list.threads)],
          ["People", String(list.participants)],
          ["Topics", String(list.topics)],
        ]}
      />

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-1 text-lg font-semibold">Thread utility</h2>
          <p className="text-muted-foreground mb-3 text-sm">
            How the {list.threads} threads were carried.
          </p>
          <LevelBar counts={list.utility} help={UTILITY_HELP} />
        </section>
        <section>
          <h2 className="mb-1 text-lg font-semibold">Contributor record</h2>
          <p className="text-muted-foreground mb-3 text-sm">
            What the {list.participants} people posting here have published.
          </p>
          <LevelBar counts={list.contributor} help={CONTRIBUTOR_HELP} />
        </section>
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Topics</h2>
        {list.topics_refused && (
          <p className="text-muted-foreground max-w-[76ch] text-sm">
            None. {list.topics_refused}{" "}
            <a className="text-primary underline" href="/methodology/#topics">
              How clustering is calibrated
            </a>
            .
          </p>
        )}
      </section>

      {topics.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">Topics</h2>
          <ul className="divide-y">
            {topics.slice(0, 20).map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                <a className="hover:text-primary hover:underline" href={`/topics/${t.id}/`}>
                  {t.label}
                </a>
                <span className="text-muted-foreground tnum ml-auto text-xs">
                  {plural(t.threads.length, "thread")} · {plural(t.messages, "message")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Busiest threads</h2>
        <ul className="divide-y">
          {threads.slice(0, 20).map((t) => (
            <li key={t.id} className="flex items-start gap-2.5 py-2.5">
              <span className="mt-[3px]">
                <LevelChip level={t.utility} />
              </span>
              <div className="min-w-0 flex-1">
                <a className="hover:text-primary text-sm hover:underline" href={`/threads/${t.slug}/`}>
                  {tidySubject(t.subject)}
                </a>
                <div className="text-muted-foreground tnum mt-0.5 text-xs">
                  {plural(t.messages, "message")} · {plural(t.participants.length, "person", "people")} ·{" "}
                  {Math.round(t.top_two_share * 100)}% from the busiest two
                </div>
              </div>
            </li>
          ))}
        </ul>
        {threads.length > 20 && (
          <p className="text-muted-foreground mt-2 text-xs">and {threads.length - 20} more</p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Busiest people</h2>
        <ul className="divide-y">
          {people.slice(0, 20).map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
              <LevelChip level={contributorLevel(p.score)} />
              <a className="hover:text-primary hover:underline" href={`/people/${p.id}/`}>
                {p.name}
              </a>
              <span className="text-muted-foreground tnum ml-auto text-xs">
                {plural(p.messages, "message")} · contributor {p.score}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </SiteShell>
  );
}
