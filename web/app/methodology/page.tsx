import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { Num } from "@/components/measure-cell";
import { loadPublic } from "@/lib/data";

const REPO = "https://github.com/OR13/laocoon";

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-8 max-w-[78ch] scroll-mt-6">
      <h2 className="mb-2 border-b pb-1 text-lg font-semibold">{title}</h2>
      <div className="text-muted-foreground space-y-2 text-sm">{children}</div>
    </section>
  );
}

export default async function MethodologyPage() {
  const { windows, measures } = await loadPublic();
  const provenance = measures[0]?.provenance;

  return (
    <SiteShell
      title="LAOCOÖN — methodology"
      lede="What is measured, what is excluded, and why."
      active="/methodology/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
    >
      <Section title="What is measured">
        <p>
          Reception and graph position. Content that draws substantive replies from
          centrally-connected accounts is engaged with; content whose only engagement
          comes from an isolated peripheral cluster is not. Both are read off the reply
          graph, and neither requires a judgement about anyone&apos;s nature.
        </p>
      </Section>

      <Section title="What is not measured, ever">
        <p>
          <strong>Provenance.</strong> This system does not detect AI-generated text and
          never forms, stores, or publishes the claim that an account or message is
          machine-generated. Detection is unreliable, and a participant using a model well
          can produce a genuinely valuable contribution. The classifier prompt explicitly
          instructs the model not to speculate about how a message was produced.
        </p>
        <p>
          Also excluded: <strong>employer, affiliation and domain reputation</strong> —
          suggestive privately and defamatory publicly, and a legitimate newcomer with a
          personal domain looks identical to a fabricated one.{" "}
          <strong>External SDO and academic credentials</strong> — they can only be joined
          on a name, and a name join is trivially claimable, which would <em>create</em>{" "}
          the credibility-faking attack this project exists to resist.
        </p>
      </Section>

      <Section title="Reply graph">
        <p>
          Edges come only from <code>In-Reply-To</code> and <code>References</code>.
          Subject-line threading is deliberately not implemented: it manufactures edges the
          corpus does not contain. Messages with no threading headers are reported as a
          count and left unattached.
        </p>
      </Section>

      <Section title="The seed rule">
        <p>
          Reputation propagation starts from <strong>community-conferred</strong> standing
          only: working group chairs past and present, area directors, IAB and IESG
          members, RFC authors, and authors of adopted <code>draft-ietf-*</code> documents.
          Submitting an individual draft does <strong>not</strong> count — that is standing
          a participant conferred on themselves, and admitting it would make the seed
          forgeable by exactly the behaviour this resists. The rule is published in full at{" "}
          <a className="text-primary underline" href={`${REPO}/blob/main/docs/seed-rule.md`}>
            docs/seed-rule.md
          </a>{" "}
          and is recomputed, never hand-maintained.
        </p>
        <p>
          Membership of the seed is <em>not</em> published: it is a label attached to
          identifiable people. That costs nothing in contestability — the rule is public
          and the Datatracker is public, so anyone can recompute the membership and
          disagree.
        </p>
      </Section>

      <Section title="Judging what a message offers">
        <p>
          The first attempt asked a local model one question — does this reply address
          something specific in its parent — and returned <em>substantive</em> for 162 of
          164 replies, <em>hollow</em> once and <em>unclear</em> once. A binary that never
          says one of its two words measures nothing. It also only ever ran against
          agentproto, because the reply graph it read covered one list.
        </p>
        <p>
          Novelty was failing from the other direction. It is the share of a reply&apos;s
          sentences that say something the thread had not already said, so fluent filler
          scores <em>high</em> on it: new words, new framings, nothing checkable. Neither
          measure could see a message that commits to nothing.
        </p>
        <p>
          Two measures replaced them, both computed rather than judged, both over
          authored text only so a reply never inherits the citations in the message it
          quotes.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Concreteness</strong> counts what a message points at that a reader
            could go and check: Internet-Draft names, RFC numbers, section references,
            URLs, code, normative keywords, questions, contradictions. A message over 40
            words that cites nothing, contests nothing and asks nothing is reported as
            offering nothing checkable. Short acknowledgements are excluded, because a
            brief &ldquo;yes, that works&rdquo; is a normal and useful thing to send.
          </li>
          <li>
            <strong>Distinctiveness</strong> is a message&apos;s TF-IDF similarity to the
            rest of its own thread minus its similarity to messages from other threads on
            the same list. A reply engaging with what is being discussed shares vocabulary
            with its thread; one made of list-general language is equally close to
            everything, so the difference falls to zero or below. Terms rather than
            embeddings, because two messages saying different things about the same
            subject are semantically close, and shared terms are what belonging to a
            conversation actually rests on.
          </li>
        </ul>
        <p>
          Distinctiveness is computed because a model would not report it. Asked whether a
          reply restates the thread, or could be moved into another thread without looking
          out of place, a local model answered no for every message in a 43-message sample,
          twice, under two phrasings — the two properties whose &ldquo;true&rdquo; is
          unflattering are the two it would not state. Demanding a quote instead of a
          verdict fixed a third flag that had fired on every message; it did nothing for
          these two.
        </p>
        <p>
          Thread-level medians are withheld below four messages. A two-message thread&apos;s
          similarity to &ldquo;the rest of its own thread&rdquo; is one pairwise comparison,
          and sorting the published table by it put those threads at the top.
        </p>
        <p>
          <strong>None of this concerns provenance.</strong> A person writing
          list-general prose that cites nothing scores exactly the same as anything else
          writing it. Per-message rows are private, because a per-message quality label
          joined to a sender is a per-person quality score; only per-thread medians and
          list-level shares are published.
        </p>
        {provenance && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-1">
            <dt>Seed rule version</dt><dd>{provenance.seed_rule_version}</dd>
          </dl>
        )}
      </Section>

      <Section title="Publication record score" id="record-score">
        <p>
          Each account gets a score out of 100 summarising what the IETF&apos;s own records
          say they have published. It is used to colour the network on the overview and to
          band the daily traffic. It replaced a binary — holds community-conferred standing,
          or does not — which sorted a mailing list into two classes of person and read as
          a caste mark.
        </p>
        <p>
          <strong>It is not a rating of anyone&apos;s messages</strong>, their judgement, or
          their worth to a discussion. Every term is a count of something already published
          under that person&apos;s name. A score of zero means no published IETF record,
          which is the ordinary state of a new participant and of anyone who contributes
          without filing documents. Nothing in the pipeline treats a low score as a reason
          to discount a message, and no measure of message quality feeds into it.
        </p>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1.5 text-left font-semibold">Term</th>
              <th className="py-1.5 text-right font-semibold">Points</th>
              <th className="py-1.5 text-left font-semibold">Full at</th>
            </tr>
          </thead>
          <tbody className="[&_td]:py-1.5">
            <tr className="border-b">
              <td>Published RFCs</td>
              <td className="tnum text-right">40</td>
              <td>25 RFCs</td>
            </tr>
            <tr className="border-b">
              <td>Adopted working-group drafts (<code>draft-ietf-*</code>)</td>
              <td className="tnum text-right">20</td>
              <td>5 drafts</td>
            </tr>
            <tr className="border-b">
              <td>Currently chairs a working group</td>
              <td className="tnum text-right">25</td>
              <td>—</td>
            </tr>
            <tr className="border-b">
              <td>Has chaired one</td>
              <td className="tnum text-right">12</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Area Director, IAB or IESG</td>
              <td className="tnum text-right">15</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
        <p className="pt-1">
          The two counted terms <strong>saturate logarithmically</strong>: the difference
          between nought and three RFCs says far more than the difference between sixty and
          eighty-three, and without saturation the handful of very prolific authors would
          flatten everyone else against zero. Chairing counts once at its highest level —
          a current chair who also chaired before has one responsibility, not two.
        </p>
        <p>
          The constants are <strong>fixed reference points, not percentiles of this
          corpus</strong>. Deriving them from the crawl would move the scale every time it
          grew and make two runs incomparable, which is the same
          cannot-produce-a-negative-result failure that removed the health verdict. They
          are stated here so each can be argued with on its own, and the score always
          breaks back down into its parts on screen.
        </p>
        <p>
          Bands are round numbers on the scale — 0, 1–29, 30–59, 60–100 — and are named for
          a quantity of published work rather than for a kind of person. An individual
          submission that no working group adopted does not count, on the same reasoning as
          the seed rule: it is an act by the author rather than one the community took.
        </p>
      </Section>

      <Section title="Topics">
        <p>
          Threads are clustered by complete-linkage agglomeration over message
          embeddings, and the distance threshold is chosen by held-out prediction rather
          than by inspection: the winning threshold is the one whose clusters best predict
          engagement in a window the clustering never saw. It is scored against two
          baselines — grouping by subject line, and putting everything in one cluster.
        </p>
        <p>
          A cap stops any one cluster taking more than a third of the corpus, and threads
          are allowed to belong to no topic rather than being forced into the nearest one.
          A list whose threads are all one conversation therefore contributes no topics at
          all, which is the correct answer and not a failure.
        </p>
      </Section>

      <Section title="Why volume is reported but not rewarded">
        <p>
          Reply volume is the baseline every forecaster is scored against, and on the
          larger list nothing has beaten it. That is reported rather than hidden: a
          measure that cannot beat counting messages has not earned its place. It is also
          the reason volume is never presented as a quality signal — the two lists
          disagree about it, with the baseline running negative on agentproto and winning
          on agent2agent, which is what a 106-message corpus looks like next to a
          1,233-message one.
        </p>
      </Section>

      <Section title="Fairness commitments">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Accounts are bucketed as new participant versus established, and new
            participants are <strong>described, never ranked</strong>. Age plus history
            structurally punishes newcomers, and the IETF depends on them.
          </li>
          <li>Every signal used is one a participant can verify and contest.</li>
          <li>
            &ldquo;No datatracker record&rdquo; is reported as a fact about a lookup, never
            as an inference about why.
          </li>
          <li>Per-person quality scores and ranked participant lists are never published.</li>
        </ul>
      </Section>

      <Section title="Corrections">
        <p>
          Every figure derives from a JSON event committed to the repository. A dispute is
          a GitHub issue against that file. Events are immutable: a correction is a
          compensating event, never an edit.
        </p>
      </Section>

      <section className="mt-8">
        <h2 className="mb-2 border-b pb-1 text-lg font-semibold">Coverage</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableCaption className="px-3 py-2 text-left">
              Every crawl window recorded, so gaps are visible rather than inferred.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>List</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead className="text-right">In mailbox</TableHead>
                <TableHead className="text-right">UIDs examined</TableHead>
                <TableHead className="text-right">Failures</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {windows.slice(-12).map((w) => (
                <TableRow key={`${w.list_name}-${w.completed_at}`}>
                  <TableCell>{w.list_name}</TableCell>
                  <TableCell>{w.mode}</TableCell>
                  <TableCell className="tnum">{w.completed_at.slice(0, 19)}Z</TableCell>
                  <TableCell className="text-right"><Num value={w.mailbox_total} /></TableCell>
                  <TableCell className="text-right"><Num value={w.uids_examined} /></TableCell>
                  <TableCell className="text-right"><Num value={w.failures.length} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </SiteShell>
  );
}
