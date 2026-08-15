import { Banner, SiteShell } from "@/components/site-shell";
import { ParticipationGraph } from "@/components/participation-graph";
import { loadPrivate } from "@/lib/data";

/**
 * The one page that names people.
 *
 * The file is named `page.private.tsx`, and `private.tsx` is only in Next's
 * `pageExtensions` when LAOCOON_PRIVATE=1. In a public build this file is not a
 * page at all — the route does not exist, rather than existing and being empty.
 * A byte-level sender-hash scan over the exported files backs that up, because
 * a published file cannot be unpublished.
 */
export default async function PrivateGraphPage() {
  const data = await loadPrivate();
  const seeded = data.persons.filter((p) => p.seeded).length;

  return (
    <SiteShell
      title="Participation and reply graph"
      lede="Who engages with which threads, and who replies to whom. Click any node — or any name in the tables — for a profile."
      active=""
      nav={[]}
      banner={
        <Banner>
          <strong className="text-[var(--warn)]">Private — never publish this page.</strong>{" "}
          It names participants and ranks them, which PROBLEM.md §7 keeps out of
          publication. §7 makes this private <em>to Orie</em>, not nonexistent — this is
          the operator&apos;s working view. It is built only when{" "}
          <code>LAOCOON_PRIVATE=1</code>, exported under <code>private/</code>, which is
          gitignored. Every number is a count of messages or a position in a graph: none
          of it judges anyone&apos;s contribution, and none of it says anything about how
          any message was written.
        </Banner>
      }
      footer={
        <p>
          Generated {data.generated_at} · {data.persons.length} people ·{" "}
          {data.threads.length} threads · {data.participation.length} participation edges ·{" "}
          {data.replies.length} reply edges. Private working view: not published, not
          committed, not deployed.
        </p>
      }
    >
      <ParticipationGraph data={data} />

      <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3 rounded-full border-2 border-[var(--primary)] bg-[var(--seq-700)]" />
          person
        </span>
        <span className="flex items-center gap-1.5">
          reputation
          <i className="inline-block h-2 w-16 rounded-sm border bg-[linear-gradient(90deg,var(--seq-100),var(--seq-400),var(--seq-700))]" />
          low → high
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3 rounded-full border-[3px] border-[var(--primary)] bg-[var(--seq-250)]" />
          thick ring: community-conferred standing ({seeded} of {data.persons.length})
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3 rounded-full border border-dashed border-[var(--primary)] bg-[var(--seq-100)]" />
          dashed: no standing
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3 rounded-sm border border-[var(--thread-line)] bg-[var(--thread-bg)]" />
          thread
        </span>
        <span>node area ∝ messages</span>
      </div>

      <p className="text-muted-foreground mt-3 max-w-[76ch] text-xs">
        Layout is fCoSE, run in the browser and re-runnable; it is force-directed, so the
        picture differs slightly between runs. Reputation is personalized PageRank
        restarted on accounts holding community-conferred standing, over edges pointing
        from a replier to the author they replied to — it measures whose messages drew
        engagement from the established part of the group, and it is a graph position, not
        a measure of anyone&apos;s worth. More colour means more reputation in both themes,
        and fill is assigned by <em>rank</em> rather than raw score, because PageRank has a
        long near-zero tail a linear ramp would collapse into one shade. A{" "}
        <strong>large, faint</strong> node is high volume with little reception, which is
        the pattern this project exists to surface. Threads with a single message are
        hidden by default — they have no reply structure; the slider brings them back.{" "}
        {data.self_reply_edges_dropped} self-replies are excluded: answering your own
        message is not evidence of anyone else&apos;s engagement.
      </p>
    </SiteShell>
  );
}
