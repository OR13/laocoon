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

      <Section title="The two Laocoön scores" id="scores">
        <p>
          <strong>The Laocoön contributor score</strong> is 0–100 over what the IETF&apos;s own
          records say an account has published. It replaced a binary — holds
          community-conferred standing, or does not — which sorted a mailing list into two
          classes of person and read as a caste mark.
        </p>
        <p>
          <strong>It is not a rating of anyone&apos;s messages</strong>, their judgement, or
          their worth to a discussion. A score of zero means no published IETF record, which
          is the ordinary state of a new participant and of anyone who contributes without
          filing documents. Nothing in the pipeline treats a low score as a reason to
          discount a message, and no measure of message content feeds into it.
        </p>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-1.5 text-left font-semibold">Weighted unit</th>
              <th className="py-1.5 text-right font-semibold">Points each</th>
            </tr>
          </thead>
          <tbody className="[&_td]:py-1.5">
            <tr className="border-b"><td>Published RFC</td><td className="tnum text-right">1</td></tr>
            <tr className="border-b"><td>Adopted working-group draft (<code>draft-ietf-*</code>)</td><td className="tnum text-right">1</td></tr>
            <tr className="border-b"><td>Currently chairs a working group</td><td className="tnum text-right">5</td></tr>
            <tr className="border-b"><td>Has chaired one</td><td className="tnum text-right">2</td></tr>
            <tr><td>Area Director, IAB or IESG</td><td className="tnum text-right">4</td></tr>
          </tbody>
        </table>
        <p className="pt-1">
          Those units are then put through a <strong>logistic curve</strong>, at the
          operator&apos;s direction:{" "}
          <code>score = 100 · (L(raw) − L(0)) / (1 − L(0))</code> where{" "}
          <code>L(x) = 1 / (1 + e^(−0.22(x − 8)))</code>. A linear or saturating sum spends
          most of its range separating a very prolific author from an extremely prolific
          one, which is the least interesting comparison on the list. An S-curve spends it
          in the middle, where the difference between two documents and fifteen actually
          distinguishes people: 1 unit scores 3, 3 units 12, 8 units 41, 12 units 66, 20
          units 92. The <code>− L(0)</code> term anchors it — without it an empty record
          scores about 12, and having filed nothing would read as a low grade rather than
          as an absence.
        </p>
        <p>
          Chairing counts once at its highest level: a current chair who also chaired before
          holds one responsibility, not two. An individual submission no working group
          adopted does not count, on the same reasoning as the seed rule — it is an act by
          the author rather than one the community took. The constants are fixed reference
          points rather than percentiles of this corpus, because derived from the crawl the
          scale would move every time it grew and two runs would not be comparable.
        </p>

        <h3 className="text-foreground mt-6 mb-1 font-semibold">Laocoön utility score</h3>
        <p>
          Per thread, and <strong>three levels rather than a number</strong>: low, medium,
          high. A continuous score here would invite an argument about weights that cannot
          be won; a level built from a conjunction of thresholds can be disagreed with one
          condition at a time, and every input is shown beside it.
        </p>
        <p>
          It was going to be called health. That word is wrong: it implies a verdict on a
          discussion, and none of these inputs can support one. What they describe is who
          did the talking.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>High</strong> — six messages or more, four or more participants, under
            70% of the messages from the busiest two accounts, and at least one participant
            with a contributor score of 35 or more.
          </li>
          <li>
            <strong>Low</strong> — either a thread of six or more that two or three accounts
            carried at 80% or above, or a short exchange between two accounts with no
            published record.
          </li>
          <li>
            <strong>Medium</strong> — meets some of the conditions for high, or is too short
            to say.
          </li>
        </ul>
        <p>
          <strong>A low is a prompt to read the thread, not a verdict on it.</strong> Two
          experts working through a detail produce exactly the shape two amplifying accounts
          produce, and this measures the shape. There is a test asserting the two score
          identically, because the day they stop doing so is the day this has quietly become
          a provenance detector.
        </p>
        {provenance && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-1">
            <dt>Seed rule version</dt><dd>{provenance.seed_rule_version}</dd>
          </dl>
        )}
      </Section>

      <Section title="Topics" id="topics">
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
          all, which is the correct answer and not a failure — on agentproto every one of
          the nine candidate thresholds was refused, because even the tightest put 56% of
          its 24 threads in a single cluster. The list is one charter discussion, and
          splitting it would have invented structure that is not there.
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

      <Section title="Whether any of it predicts anything" id="accuracy">
        <p>
          Every measure here is scored against the same standard: rank the threads at time{" "}
          <em>T</em>, then check at <em>T+h</em> whether the engagement it ranked highest
          actually arrived. The baseline is raw reply volume — no model, no seed. The
          question is never &ldquo;does this predict anything&rdquo; but &ldquo;does it
          predict better than counting messages&rdquo;.
        </p>
        <p>
          <strong>Mostly it does not, and that is reported rather than buried.</strong> On
          agent2agent the volume baseline wins at +0.466 and nothing has beaten it. On
          agentproto the baseline runs <em>negative</em> at −0.236 while seeded
          participation reaches +0.544. Two lists, opposite answers, 106 messages against
          1,233 — which is why nothing on this site is presented as a forecast.
        </p>
        <p>
          Three independent measures of what a message contains — concreteness, novelty and
          thread-specificity — were each tested this way and none of them predicts whether
          an established account replies. Only asking a question does, and only weakly.
          They are kept as descriptions of what is being written, which is a different
          claim from what will happen next.
        </p>
        <p>
          Origins roll daily, so successive windows overlap and the runs are correlated;
          they are not independent trials. 761 of the recorded evaluations predate the list
          being written onto the event, and since events here are immutable those runs are
          excluded rather than attributed to a guess.
        </p>
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
