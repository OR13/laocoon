import { notFound } from "next/navigation";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { coverageLine, loadPublic } from "@/lib/data";
import { tidySubject } from "@/lib/graph-model";
import {
  BODY_ROLE_LABEL, contributorLevel, LEVEL_META, LEVELS, UTILITY_HELP, type Level, type NetworkThread,
} from "@/lib/scores";
import { withBase } from "@/lib/base";

/**
 * One page per account, with everything the pipeline holds about them.
 *
 * Statically generated, one file per person, because the site is an export
 * with no server. Everything here is either republished from a public list
 * post or computed from the Datatracker, and the contributor score is broken
 * into the counts it came from rather than presented as a verdict.
 */

export async function generateStaticParams() {
  const { network } = await loadPublic();
  return (network?.nodes ?? []).map((p) => ({ slug: p.id }));
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3" title={hint}>
      <div className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</div>
      <div className="tnum mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export default async function PersonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { network, windows } = await loadPublic();
  const person = network?.nodes.find((p) => p.id === slug);
  if (!person || !network) notFound();

  const own = network.threads
    .filter((t) => t.participants.includes(person.id))
    .sort((a, b) => b.messages - a.messages);

  const counts = { high: 0, medium: 0, low: 0 } as Record<Level, number>;
  for (const t of own) counts[t.utility]++;

  const topics = [
    ...new Map(own.filter((t) => t.topic_label).map((t) => [t.topic_id!, t.topic_label!])),
  ];

  // Who this person actually goes back and forth with. Directed edges are
  // summed both ways: a conversation is not one-sided.
  const withWhom = new Map<string, number>();
  for (const e of network.edges) {
    if (e.source === person.id) withWhom.set(e.target, (withWhom.get(e.target) ?? 0) + e.replies);
    if (e.target === person.id) withWhom.set(e.source, (withWhom.get(e.source) ?? 0) + e.replies);
  }
  const byName = new Map(network.nodes.map((p) => [p.id, p]));
  const partners = [...withWhom]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id, replies]) => ({ person: byName.get(id), replies }))
    .filter((row) => row.person);

  const threadRow = (t: NetworkThread) => (
    <li key={t.id} className="py-2.5">
      <a
        href={t.href}
        target="_blank"
        rel="noreferrer"
        className="hover:text-primary text-sm hover:underline"
      >
        {tidySubject(t.subject)} ↗
      </a>
      <div className="text-muted-foreground tnum mt-0.5 text-xs">
        {t.messages} message{t.messages === 1 ? "" : "s"} · {t.participants.length} participant
        {t.participants.length === 1 ? "" : "s"} ·{" "}
        <span title={UTILITY_HELP[t.utility]}>{LEVEL_META[t.utility].label}</span> ·{" "}
        {Math.round(t.top_two_share * 100)}% from the busiest two
        {t.quiet_for_days !== null && ` · quiet ${t.quiet_for_days}d`}
        {t.topic_label && (
          <span className="ml-1.5 opacity-80">· {t.topic_label}</span>
        )}
      </div>
    </li>
  );

  return (
    <SiteShell
      title={person.name}
      lede={`Everything this project holds about one account on ${person.lists.join(" and ")}.`}
      active="/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={<p>{coverageLine(windows)}</p>}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Contributor score"
          value={`${person.score}/100`}
          hint="RFCs, adopted drafts and IETF roles, on a logistic curve. Not a rating of their messages."
        />
        <Stat label="Messages" value={String(person.messages)} />
        <Stat label="Replies sent" value={String(person.replies_sent)} />
        <Stat label="Replies received" value={String(person.replies_received)} />
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Published record</h2>
        <div className="max-w-[70ch] space-y-1 text-sm">
          <p className="text-muted-foreground">
            <span className="text-foreground tnum font-medium">{person.rfcs}</span> published RFC
            {person.rfcs === 1 ? "" : "s"} ·{" "}
            <span className="text-foreground tnum font-medium">{person.adopted_drafts}</span>{" "}
            adopted working-group draft{person.adopted_drafts === 1 ? "" : "s"}
            {person.chairs_now && " · currently chairs a working group"}
            {person.body_role && ` · ${BODY_ROLE_LABEL[person.body_role]}`}
            {!person.in_datatracker && " · no Datatracker record"}
          </p>
          <p className="text-muted-foreground">
            Band{" "}
            <span className="inline-flex items-center gap-1.5">
              <i
                className="inline-block size-2.5 rounded-full"
                style={{ background: `var(${LEVEL_META[contributorLevel(person.score)].token})` }}
              />
              {LEVEL_META[contributorLevel(person.score)].label}
            </span>{" "}
            —{" "}
            <a className="text-primary underline" href={withBase("/methodology/#scores")}>
              how this is computed
            </a>
            .
          </p>
          {person.first_seen && (
            <p className="text-muted-foreground">
              First posted {person.first_seen.slice(0, 10)}.
            </p>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-1 text-lg font-semibold">Threads</h2>
        <p className="text-muted-foreground mb-3 max-w-[76ch] text-sm">
          {own.length} thread{own.length === 1 ? "" : "s"}
          {topics.length > 0 && ` across ${topics.length} topic${topics.length === 1 ? "" : "s"}`}
          {" — "}
          {LEVELS.filter((k) => counts[k] > 0)
            .map((k) => `${counts[k]} ${LEVEL_META[k].label.toLowerCase()}`)
            .join(", ")}{" "}
          by Laocoön utility score.
        </p>
        {topics.length > 0 && (
          <p className="text-muted-foreground mb-3 text-sm">
            <span className="text-foreground font-medium">Topics:</span>{" "}
            {topics.map(([, label]) => label).join(" · ")}
          </p>
        )}
        <ul className="divide-y">{own.slice(0, 30).map(threadRow)}</ul>
        {own.length > 30 && (
          <p className="text-muted-foreground mt-2 text-xs">and {own.length - 30} more</p>
        )}
      </section>

      {partners.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-lg font-semibold">Who they exchange with</h2>
          <p className="text-muted-foreground mb-3 max-w-[76ch] text-sm">
            Replies in either direction, most frequent first.
          </p>
          <ul className="divide-y">
            {partners.map(({ person: other, replies }) => (
              <li key={other!.id} className="flex items-center gap-2 py-2 text-sm">
                <i
                  className="inline-block size-2.5 shrink-0 rounded-full"
                  style={{ background: `var(${LEVEL_META[contributorLevel(other!.score)].token})` }}
                />
                <a className="hover:text-primary hover:underline" href={withBase(`/people/${other!.id}/`)}>
                  {other!.name}
                </a>
                <span className="text-muted-foreground tnum ml-auto text-xs">
                  {replies} repl{replies === 1 ? "y" : "ies"} · record {other!.score}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </SiteShell>
  );
}
