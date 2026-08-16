import { notFound } from "next/navigation";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { coverageLine, loadPublic } from "@/lib/data";
import { tidySubject } from "@/lib/graph-model";
import { plural } from "@/components/entity";
import { contributorLevel, LEVEL_META, LEVELS, UTILITY_HELP } from "@/lib/scores";

/**
 * One page per topic.
 *
 * A topic is a cluster of threads, so its page is the threads in it and the
 * people who showed up — with each thread's Laocoön utility score and each
 * person's contributor score, which is what "how has this subject gone" is
 * made of. The topic itself carries no score: it is a container, and grading
 * a subject would be a judgement none of this data supports.
 */

export async function generateStaticParams() {
  const { network } = await loadPublic();
  return (network?.topics ?? []).map((t) => ({ slug: t.id }));
}

export default async function TopicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { network, windows } = await loadPublic();
  const topic = network?.topics.find((t) => t.id === slug);
  if (!topic || !network) notFound();

  const threads = network.threads
    .filter((t) => topic.threads.includes(t.id))
    .sort((a, b) => b.messages - a.messages);
  const people = topic.participants
    .map((id) => network.nodes.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .sort((a, b) => b.score - a.score || b.messages - a.messages);

  const total = LEVELS.reduce((n, l) => n + (topic.utility[l] ?? 0), 0) || 1;

  return (
    <SiteShell
      title={topic.label}
      lede={`A subject on ${topic.lists.join(" and ")}, and how its threads have gone.`}
      active="/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={<p>{coverageLine(windows)}</p>}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Threads", String(topic.threads.length)],
          ["Messages", String(topic.messages)],
          ["People", String(topic.participants.length)],
          ["Highest contributor score", `${topic.top_contributor}/100`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <div className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</div>
            <div className="tnum mt-1 text-2xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Utility of its threads</h2>
        <div className="flex h-7 w-full overflow-hidden rounded-md border">
          {LEVELS.filter((l) => (topic.utility[l] ?? 0) > 0).map((l) => (
            <div
              key={l}
              title={UTILITY_HELP[l]}
              style={{
                width: `${((topic.utility[l] ?? 0) / total) * 100}%`,
                background: `var(${LEVEL_META[l].token})`,
              }}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {LEVELS.map((l) => (
            <span key={l} className="flex items-center gap-1.5" title={UTILITY_HELP[l]}>
              <i
                className="inline-block size-2.5 rounded-[3px]"
                style={{ background: `var(${LEVEL_META[l].token})` }}
              />
              <span className="tnum text-foreground font-medium">{topic.utility[l] ?? 0}</span>
              <span className="text-muted-foreground">{LEVEL_META[l].label.toLowerCase()}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Threads</h2>
        <ul className="divide-y">
          {threads.map((t) => (
            <li key={t.id} className="flex items-start gap-2.5 py-2.5">
              <i
                aria-hidden
                className="mt-[5px] inline-block size-2.5 shrink-0 rounded-[2px]"
                style={{ background: `var(${LEVEL_META[t.utility].token})` }}
                title={UTILITY_HELP[t.utility]}
              />
              <div className="min-w-0 flex-1">
                <a
                  href={t.href}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-primary text-sm hover:underline"
                >
                  {tidySubject(t.subject)} ↗
                </a>
                <div className="text-muted-foreground tnum mt-0.5 text-xs">
                  utility {LEVEL_META[t.utility].label.toLowerCase()} · {plural(t.messages, "message")} ·{" "}
                  {plural(t.participants.length, "participant")} ·{" "}
                  {Math.round(t.top_two_share * 100)}% from the busiest two
                  {t.quiet_for_days !== null && ` · quiet ${t.quiet_for_days}d`}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">Who took part</h2>
        <ul className="divide-y">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
              <i
                aria-hidden
                className="inline-block size-2.5 shrink-0 rounded-full"
                style={{ background: `var(${LEVEL_META[contributorLevel(p.score)].token})` }}
              />
              <a className="hover:text-primary hover:underline" href={`/people/${p.id}/`}>
                {p.name}
              </a>
              <span className="text-muted-foreground tnum ml-auto text-xs">
                contributor {p.score} · {p.messages} messages
              </span>
            </li>
          ))}
        </ul>
      </section>
    </SiteShell>
  );
}
