import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { LevelBar, plural } from "@/components/entity";
import { coverageLine, loadPublic } from "@/lib/data";
import { UTILITY_HELP } from "@/lib/scores";

export default async function TopicsPage() {
  const { network, windows } = await loadPublic();
  const topics = [...(network?.topics ?? [])].sort((a, b) => b.messages - a.messages);
  const listsWithRefusal = (network?.mailing_lists ?? []).filter((l) => l.topics_refused);

  return (
    <SiteShell
      title="Topics"
      lede="Clusters of threads about the same thing. A thread belongs to at most one."
      active="/topics/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={<p>{coverageLine(windows)}</p>}
    >
      {listsWithRefusal.length > 0 && (
        <div className="mb-6 space-y-2">
          {listsWithRefusal.map((l) => (
            <div key={l.name} className="bg-card text-muted-foreground rounded-lg border p-3 text-xs">
              <strong className="text-foreground font-medium">{l.name}:</strong> No topics.{" "}
              {l.topics_refused}{" "}
              <a className="text-primary underline" href="/methodology/#topics">
                How clustering is calibrated
              </a>
              .
            </div>
          ))}
        </div>
      )}

      {topics.length > 0 ? (
        <ul className="divide-y">
          {topics.map((t) => (
            <li key={t.id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <a className="hover:text-primary font-medium hover:underline" href={`/topics/${t.id}/`}>
                  {t.label}
                </a>
                <span className="text-muted-foreground tnum text-xs">
                  {plural(t.threads.length, "thread")} · {plural(t.messages, "message")} ·{" "}
                  {plural(t.participants.length, "person", "people")} · {t.lists.join(", ")}
                </span>
              </div>
              <div className="mt-2 max-w-[34rem]">
                <LevelBar counts={t.utility} help={UTILITY_HELP} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground py-6 text-sm">
          No topic clusters formed across the crawled mailing lists.
        </p>
      )}
    </SiteShell>
  );
}

