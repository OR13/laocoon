import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { archiveMessageUrl } from "@/lib/archive";
import type { Contribution, ContributionMessage } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * What draws engagement, and what got buried.
 *
 * The operator's stated problem: useful comments are getting lost in the volume,
 * and new people need to learn how to contribute successfully. Both are signal
 * recovery. Nothing here measures whether anything was machine-generated, and
 * none of these inputs could — they are word counts, graph positions and
 * overlap with earlier text.
 */

const LABELS: Record<string, string> = {
  authored_lines: "Length of the reply",
  novelty: "How much was new",
  depth: "Depth in the thread",
  author_already_had_standing: "Author already had standing",
};

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const strong = Math.abs(value) >= 0.15;
  return (
    <span
      className={cn("tnum font-semibold", strong ? "text-foreground" : "text-muted-foreground")}
    >
      {value > 0 ? "+" : ""}
      {value.toFixed(3)}
    </span>
  );
}

function MessageRow({ m, list }: { m: ContributionMessage; list: string }) {
  return (
    <li className="border-b py-2 last:border-0">
      <a
        className="text-primary text-xs hover:underline"
        href={archiveMessageUrl(m.message_id, list)}
        target="_blank"
        rel="noreferrer"
      >
        {m.gist || m.message_id.slice(0, 60)} ↗
      </a>
      <div className="text-muted-foreground tnum mt-0.5 text-[11px]">
        {m.sent_at?.slice(0, 10) ?? "—"} · {m.replies_from_standing} repl
        {m.replies_from_standing === 1 ? "y" : "ies"} from standing · thread of{" "}
        {m.thread_messages}
      </div>
    </li>
  );
}

export function ContributionCard({ data }: { data: Contribution }) {
  const rows = Object.entries(data.what_works).filter(([k]) => k in LABELS);
  const strongest = rows
    .map(([k, v]) => ({ k, d: Math.abs(v.delta ?? 0) }))
    .sort((a, b) => b.d - a.d)[0];

  return (
    <Card className="mt-6" data-review="contribution">
      <CardHeader>
        <CardTitle className="text-base">
          What draws engagement — {data.list_name}
        </CardTitle>
        <CardDescription>
          {data.replies_that_drew_standing_engagement} of {data.replies_examined} replies drew
          a response from an account holding community-conferred standing. These are the
          differences between those that did and those that did not — Cliff&apos;s delta,
          where 0 means no difference and ±1 means complete separation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-background">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-semibold">Property</th>
                <th className="px-3 py-2 text-right font-semibold">Drew engagement</th>
                <th className="px-3 py-2 text-right font-semibold">Did not</th>
                <th className="px-3 py-2 text-right font-semibold">Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([key, v]) => (
                <tr key={key} className="border-b last:border-0">
                  <td className="px-3 py-2">{LABELS[key]}</td>
                  <td className="tnum px-3 py-2 text-right">{v.with ?? "—"}</td>
                  <td className="tnum px-3 py-2 text-right">{v.without ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <Delta value={v.delta} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {strongest?.k === "author_already_had_standing" && (
          <div className="mt-3 rounded-md border border-l-[3px] border-l-[var(--warn)] bg-[var(--warn-bg)] p-3 text-xs">
            <strong className="text-[var(--warn)]">
              The strongest predictor is who wrote it, not what it says.
            </strong>{" "}
            On this list, length, novelty and depth barely move whether an established
            account replies. That is a finding about the list, not about any participant —
            and it is the thing standing between a newcomer and a successful contribution.
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Buried</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Landed with people the group listens to, in a thread of{" "}
              {data.quiet_thread_threshold} messages or fewer. These went nowhere visible.
            </p>
            <ul className="mt-2 max-h-72 overflow-auto">
              {data.buried.slice(0, 12).map((m) => (
                <MessageRow key={m.message_id} m={m} list={data.list_name} />
              ))}
              {data.buried.length === 0 && (
                <li className="text-muted-foreground py-2 text-xs italic">None found.</li>
              )}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Newcomers who landed it</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              A participant&apos;s <em>first</em> message that drew a reply from an account
              with standing. Worked examples of getting it right.
            </p>
            <ul className="mt-2 max-h-72 overflow-auto">
              {data.newcomer_wins.slice(0, 12).map((m) => (
                <MessageRow key={m.message_id} m={m} list={data.list_name} />
              ))}
              {data.newcomer_wins.length === 0 && (
                <li className="text-muted-foreground py-2 text-xs italic">None found.</li>
              )}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
