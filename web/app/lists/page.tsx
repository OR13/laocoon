import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { LevelBar, Stats } from "@/components/entity";
import { coverageLine, loadPublic } from "@/lib/data";
import { UTILITY_HELP } from "@/lib/scores";

export default async function ListsPage() {
  const { network, windows } = await loadPublic();
  const lists = network?.mailing_lists ?? [];

  return (
    <SiteShell
      title="Mailing lists"
      lede="The lists this project crawls. Threads, people and topics all sit under one."
      active="/lists/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={<p>{coverageLine(windows)}</p>}
    >
      <div className="space-y-8">
        {lists.map((list) => (
          <section key={list.name} className="border-t pt-6 first:border-t-0 first:pt-0">
            <h2 className="mb-3 text-xl font-semibold">
              <a className="hover:text-primary hover:underline" href={`/lists/${list.name}/`}>
                {list.name}
              </a>
            </h2>
            <Stats
              items={[
                ["Messages", String(list.messages)],
                ["Threads", String(list.threads)],
                ["People", String(list.participants)],
                ["Topics", String(list.topics)],
              ]}
            />
            {list.topics_refused && (
              <p className="text-muted-foreground mt-3 max-w-[76ch] text-xs">
                <strong className="text-foreground font-medium">No topics.</strong>{" "}
                {list.topics_refused}
              </p>
            )}
            <div className="mt-4 max-w-[46rem]">
              <p className="text-muted-foreground mb-1.5 text-xs">Thread utility</p>
              <LevelBar counts={list.utility} help={UTILITY_HELP} />
            </div>
          </section>
        ))}
      </div>
    </SiteShell>
  );
}
