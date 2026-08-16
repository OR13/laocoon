import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { LevelBar, plural } from "@/components/entity";
import { coverageLine, loadPublic } from "@/lib/data";
import { UTILITY_HELP } from "@/lib/scores";

export default async function TopicsPage() {
  const { network, windows } = await loadPublic();
  const topics = [...(network?.topics ?? [])].sort((a, b) => b.messages - a.messages);

  return (
    <SiteShell
      title="Topics"
      lede="Clusters of threads about the same thing. A thread belongs to at most one."
      active="/topics/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={<p>{coverageLine(windows)}</p>}
    >
      <ul className="divide-y">
        {topics.map((t) => (
          <li key={t.id} className="py-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <a className="hover:text-primary font-medium hover:underline" href={`/topics/${t.id}/`}>
                {t.label}
              </a>
              <span className="text-muted-foreground tnum text-xs">
                {plural(t.threads.length, "thread")} · {plural(t.messages, "message")} ·{" "}
                {plural(t.participants.length, "person", "people")}
                · {t.lists.join(", ")}
              </span>
            </div>
            <div className="mt-2 max-w-[34rem]">
              <LevelBar counts={t.utility} help={UTILITY_HELP} />
            </div>
          </li>
        ))}
      </ul>
    </SiteShell>
  );
}
