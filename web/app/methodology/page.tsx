import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { Num } from "@/components/measure-cell";
import { loadPublic } from "@/lib/data";

const REPO = "https://github.com/OR13/laocoon";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2 border-b pb-1 text-lg font-semibold">{title}</h2>
      <div className="text-muted-foreground max-w-[72ch] space-y-2 text-sm">{children}</div>
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

      <Section title="Substance classification">
        <p>
          Every reply is judged against the message it answers by a local model, asking one
          question: does this reply address something specific in its parent? Length is not
          the criterion. Per-message verdicts are private, because a per-message quality
          label joined to a sender is a per-person quality score. Only the per-thread ratio
          is published. Two models are run, and where they disagree the case is{" "}
          <strong>flagged for review rather than resolved</strong>: choosing a winner would
          manufacture confidence out of two models that do not agree.
        </p>
        {provenance && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-1">
            <dt>Reference model</dt><dd><code>{provenance.classifier_model}</code></dd>
            <dt>Prompt version</dt><dd>{provenance.prompt_version}</dd>
            <dt>Prompt hash</dt><dd><code>{provenance.prompt_hash.slice(0, 23)}…</code></dd>
            <dt>Seed rule version</dt><dd>{provenance.seed_rule_version}</dd>
          </dl>
        )}
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
