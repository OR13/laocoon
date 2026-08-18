import { notFound } from "next/navigation";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { LevelBar, LevelChip, Stats } from "@/components/entity";
import { coverageLine, loadPublic } from "@/lib/data";
import { tidySubject } from "@/lib/graph-model";
import { contributorLevel, UTILITY_HELP } from "@/lib/scores";
import { withBase } from "@/lib/base";

/** One page per thread: what it is, who was in it, and how it went. */
export async function generateStaticParams() {
  const { network } = await loadPublic();
  return (network?.threads ?? []).map((t) => ({ slug: t.slug }));
}

export default async function ThreadPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { network, windows } = await loadPublic();
  const thread = network?.threads.find((t) => t.slug === slug);
  if (!thread || !network) notFound();

  const people = thread.participants
    .map((id) => network.nodes.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .sort((a, b) => b.score - a.score || b.messages - a.messages);

  const days =
    thread.started_at && thread.last_message_at
      ? Math.max(
          1,
          Math.round(
            (Date.parse(thread.last_message_at) - Date.parse(thread.started_at)) / 86_400_000,
          ),
        )
      : null;

  return (
    <SiteShell
      title={tidySubject(thread.subject)}
      lede={`A thread on ${thread.list_name}.`}
      active="/lists/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={<p>{coverageLine(windows)}</p>}
    >
      <p className="mb-6">
        <a
          className="text-primary text-sm hover:underline"
          href={thread.href}
          target="_blank"
          rel="noreferrer"
        >
          Read it in the IETF archive ↗
        </a>
      </p>

      <Stats
        items={[
          ["Utility", thread.utility.toUpperCase()],
          ["Messages", String(thread.messages)],
          ["People", String(thread.participants.length)],
          ["From the busiest two", `${Math.round(thread.top_two_share * 100)}%`],
        ]}
      />

      <section className="mt-10 max-w-[76ch]">
        <h2 className="mb-2 text-lg font-semibold">How it went</h2>
        <p className="text-muted-foreground text-sm">
          <LevelChip level={thread.utility} prefix="Utility" />.{" "}
          <span title={UTILITY_HELP[thread.utility]}>{thread.utility_reason}</span>
        </p>
        <p className="text-muted-foreground tnum mt-2 text-sm">
          {thread.started_at && `Started ${thread.started_at.slice(0, 10)}`}
          {days !== null && `, ran ${days} day${days === 1 ? "" : "s"}`}
          {thread.quiet_for_days !== null &&
            `, quiet for ${thread.quiet_for_days} day${thread.quiet_for_days === 1 ? "" : "s"} since`}
          .
          {thread.topic_id && thread.topic_label && (
            <>
              {" "}
              Clustered under{" "}
              <a className="text-primary hover:underline" href={withBase(`/topics/${thread.topic_id}/`)}>
                {thread.topic_label}
              </a>
              .
            </>
          )}
        </p>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Who was in it</h2>
        <ul className="divide-y">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
              <LevelChip level={contributorLevel(p.score)} />
              <a className="hover:text-primary hover:underline" href={withBase(`/people/${p.id}/`)}>
                {p.name}
              </a>
              <span className="text-muted-foreground tnum ml-auto text-xs">
                contributor {p.score} · {p.messages} message{p.messages === 1 ? "" : "s"} on
                the list
              </span>
            </li>
          ))}
        </ul>
      </section>
    </SiteShell>
  );
}
