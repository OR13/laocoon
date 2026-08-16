import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { ReviewPanel } from "@/components/review-panel";
import { OverviewSections } from "@/components/overview-sections";
import { archiveMessageUrl } from "@/lib/archive";
import { coverageLine, loadPublic, loadReview } from "@/lib/data";
import type { ListedThread } from "@/lib/threads";

export default async function OverviewPage() {
  const { activity, windows, measures, trees, contribution, network } = await loadPublic();
  const review = await loadReview();

  // Topic assignment, so the map can group related discussions. A thread with
  // no topic keeps a cluster of its own rather than being forced into the
  // nearest one.
  const topicOfThread = new Map<string, { id: string; label: string }>();
  const lastMessageAt = new Map<string, string | null>();
  for (const tree of trees) {
    for (const topic of tree.topics) {
      const label = topic.label ?? topic.subjects[0] ?? topic.id;
      for (const id of topic.threads) topicOfThread.set(id, { id: topic.id, label });
    }
    for (const thread of tree.threads) lastMessageAt.set(thread.id, thread.last_message_at);
  }

  const threads: ListedThread[] = measures.map((m) => {
    const topic = topicOfThread.get(m.thread_id);
    return {
      id: m.thread_id,
      subject: m.subject,
      list_name: m.list_name,
      topic_id: topic?.id ?? null,
      topic_label: topic?.label ?? null,
      messages: m.messages_total,
      participants: m.distinct_senders,
      with_standing: m.seeded_participants,
      uptake: m.uptake_from_standing,
      last_message_at: lastMessageAt.get(m.thread_id) ?? null,
      // Built here: lib/archive hashes with node:crypto, which cannot cross
      // into a client component.
      href: archiveMessageUrl(m.thread_id, m.list_name),
    };
  });

  return (
    <SiteShell
      title="LAOCOÖN"
      lede="Who is talking to whom on the agentproto and agent2agent lists, and what they have published."
      active="/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={
        <>
          <p>{coverageLine(windows)}</p>
          <p className="mt-1">
            Every figure derives from an event committed to the repository. Names and
            reply relationships are republished from public list posts; the publication
            record score is computed from the Datatracker and{" "}
            <a className="text-primary underline" href="/methodology/#record-score">
              defined in the methodology
            </a>
            .
          </p>
        </>
      }
    >
      {review?.pending && <ReviewPanel spec={review} />}
      <OverviewSections
        threads={threads}
        activity={activity}
        people={network?.nodes ?? []}
        replies={network?.edges ?? []}
        networkThreads={network?.threads ?? []}
        daily={network?.daily ?? []}
      />
    </SiteShell>
  );
}
