import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { Num, RatioCell } from "@/components/measure-cell";
import { loadPublic } from "@/lib/data";

export default async function ThreadsPage() {
  const { measures, windows, structure } = await loadPublic();
  const last = windows[windows.length - 1];

  const totals = {
    threads: measures.length,
    messages: measures.reduce((n, m) => n + m.messages_total, 0),
    substantive: measures.reduce((n, m) => n + m.substantive_replies, 0),
    hollow: measures.reduce((n, m) => n + m.hollow_replies, 0),
    unclear: measures.reduce((n, m) => n + m.unclear_replies, 0),
    unclassified: measures.reduce((n, m) => n + m.unclassified_replies, 0),
    unmeasured: measures.filter((m) => m.substantive_reply_ratio === null).length,
  };

  return (
    <SiteShell
      title="LAOCOÖN — thread health"
      lede="Which discussions have engagement, and which have volume."
      active="/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={
        <>
          <p>
            {last
              ? `Coverage: ${last.list_name}, ${last.mailbox_total} messages in the mailbox as of ${last.completed_at}, ${last.failures.length} fetch failures.`
              : "Coverage: no crawl window recorded."}
          </p>
          <p className="mt-1">
            Every figure derives from an event committed to the repository. If one is
            wrong, open an issue against it. Per-person scores are not published and do
            not appear on this site.
          </p>
        </>
      }
    >
      <p className="text-muted-foreground max-w-[70ch] text-sm">
        Each row is a discussion thread. The columns are a <strong>vector of separate
        measures</strong>, deliberately not combined into a score — a single number would
        invite an argument about weights that cannot be won, and one disputed input would
        contaminate every column instead of one.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Threads", totals.threads],
          ["Messages in threads", totals.messages],
          ["Replies judged substantive", totals.substantive],
          ["Replies judged hollow", totals.hollow],
          ["Model declined to judge", totals.unclear],
          ["Not yet classified", totals.unclassified],
          ["Threads with no substance measure", totals.unmeasured],
          ["Accounts with standing", structure ? `${structure.accounts.seeded} of ${structure.accounts.total}` : "—"],
        ].map(([label, value]) => (
          <Card key={String(label)} className="gap-1 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <div className="tnum text-2xl font-semibold tracking-tight">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mt-10 mb-3 border-b pb-1 text-lg font-semibold">Threads</h2>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableCaption className="px-3 py-2 text-left">
            Sorted by message count. Never sorted by any quality measure.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[22rem]">Thread</TableHead>
              <TableHead className="text-right">Messages</TableHead>
              <TableHead className="text-right">Participants</TableHead>
              <TableHead className="text-right">Depth</TableHead>
              <TableHead className="text-right">Branching</TableHead>
              <TableHead className="text-right">With standing</TableHead>
              <TableHead className="text-right">Max core</TableHead>
              <TableHead>Substantive</TableHead>
              <TableHead>Quoting</TableHead>
              <TableHead>New share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {measures.map((m) => (
              <TableRow key={m.thread_id}>
                <TableCell className="max-w-[34rem] whitespace-normal">{m.subject}</TableCell>
                <TableCell className="text-right"><Num value={m.messages_total} /></TableCell>
                <TableCell className="text-right"><Num value={m.distinct_senders} /></TableCell>
                <TableCell className="text-right"><Num value={m.max_depth} /></TableCell>
                <TableCell className="text-right"><Num value={m.mean_branching_factor} digits={2} /></TableCell>
                <TableCell className="text-right"><Num value={m.seeded_participants} /></TableCell>
                <TableCell className="text-right"><Num value={m.max_core_number} /></TableCell>
                <TableCell><RatioCell value={m.substantive_reply_ratio} /></TableCell>
                <TableCell><RatioCell value={m.quoting_reply_ratio} /></TableCell>
                <TableCell><RatioCell value={m.new_participant_share} /></TableCell>
              </TableRow>
            ))}
            {measures.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-muted-foreground italic">
                  No measures recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground mt-3 max-w-[74ch] text-sm">
        <strong>With standing</strong> counts participants holding community-conferred
        standing under the published seed rule — a count, never a list, and not a
        judgement of anyone&apos;s contribution. <strong>New share</strong> is described
        and never ranked: on a list only weeks old it is near 1 everywhere and carries
        almost no information, which is why it is shown rather than hidden.
      </p>

      {structure && (
        <>
          <h2 className="mt-10 mb-3 border-b pb-1 text-lg font-semibold">Group structure</h2>
          <p className="text-muted-foreground max-w-[70ch] text-sm">
            Communities in the reply graph, found by Louvain at modularity{" "}
            {structure.modularity.toFixed(3)} — weak at this size, and not to be read as
            strong structure. A community with no member holding community-conferred
            standing <em>and</em> a low external-edge ratio is a group that mostly replies
            to itself. That is a statement about a subgraph, not about anyone&apos;s good
            faith, and emphatically not about how anything was written.
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <Table>
              <TableCaption className="px-3 py-2 text-left">
                Communities are numbered by size. No account is named.
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="text-right">Internal edges</TableHead>
                  <TableHead className="text-right">External edges</TableHead>
                  <TableHead>External ratio</TableHead>
                  <TableHead>Has member with standing</TableHead>
                  <TableHead className="text-right">Max core</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {structure.communities.map((c) => (
                  <TableRow key={c.index}>
                    <TableCell className="text-right"><Num value={c.size} /></TableCell>
                    <TableCell className="text-right"><Num value={c.internal_edges} /></TableCell>
                    <TableCell className="text-right"><Num value={c.external_edges} /></TableCell>
                    <TableCell><RatioCell value={c.external_edge_ratio} /></TableCell>
                    <TableCell>{c.contains_seed_member ? "yes" : "no"}</TableCell>
                    <TableCell className="text-right"><Num value={c.max_core_number} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </SiteShell>
  );
}
