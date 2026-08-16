import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ExperimentalBanner, PUBLIC_NAV, SiteShell } from "@/components/site-shell";
import { Num, RatioCell } from "@/components/measure-cell";
import { ThreadTable } from "@/components/thread-table";
import { archiveMessageUrl } from "@/lib/archive";
import { coverageLine, loadPublic } from "@/lib/data";

export default async function ThreadTablePage() {
  const { measures, language, windows, structure } = await loadPublic();

  // Archive links are built here rather than in the table: `lib/archive`
  // hashes with node:crypto, which cannot cross into a client component.
  const hrefs = measures.map((m) => ({
    thread_id: m.thread_id,
    href: archiveMessageUrl(m.thread_id, m.list_name),
  }));

  return (
    <SiteShell
      title="LAOCOÖN — threads"
      lede="Every thread and its measures. Search, sort and open any of them in the archive."
      active="/threads/"
      nav={PUBLIC_NAV}
      banner={<ExperimentalBanner />}
      footer={
        <>
          <p>{coverageLine(windows)}</p>
          <p className="mt-1">
            Every figure derives from an event committed to the repository. Per-person
            scores are not published and do not appear on this site.
          </p>
        </>
      }
    >
      <p className="text-muted-foreground max-w-[70ch] text-sm">
        The columns are separate measures, never added into a score. Sort by whichever
        one you are asking about — the default is message count, which is a fact about
        size rather than an opinion about worth. Hover a column name for what it means.
      </p>

      <div className="mt-6">
        <ThreadTable measures={measures} language={language} hrefs={hrefs} />
      </div>

      {structure && (
        <>
          <h2 className="mt-12 mb-2 border-b pb-1 text-lg font-semibold">Group structure</h2>
          <p className="text-muted-foreground mb-3 max-w-[70ch] text-sm">
            Communities in the reply graph, found by Louvain at modularity{" "}
            {structure.modularity.toFixed(3)} — weak at this size, so read it as a hint
            and not as structure. A community with no member holding standing and a low
            external-edge ratio mostly replies to itself; that is a statement about a
            subgraph, not about anyone&apos;s good faith.
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
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
