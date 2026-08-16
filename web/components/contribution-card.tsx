import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { archiveMessageUrl } from "@/lib/archive";
import type { Contribution, ContributionMessage } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * What draws a reply from someone with standing — both lists in one table.
 *
 * **Why one card and not one per list.** This rendered twice, once per list,
 * as two near-identical tables about 500 pixels apart. Comparing them — which
 * is the entire reason a second list was added — meant scrolling between them
 * holding a number in your head. Two lists side by side in one row is the
 * whole finding: novelty carries a little on the small list and nothing at all
 * on the large one, and you can only see that if they are adjacent.
 *
 * Nothing here measures whether anything was machine-generated, and none of
 * these inputs could: they are word counts, graph positions, and overlap with
 * earlier text.
 */

const LABELS: Record<string, string> = {
  authored_lines: "Length of the reply",
  novelty: "How much was new",
  referent_kinds: "Things it cites",
  distinctiveness: "Specific to its thread",
  asks_a_question: "Asks a question",
  depth: "Depth in the thread",
  author_already_had_standing: "Author already had standing",
};
/** Row order, so the two most interesting lines are not buried mid-table. */
const ORDER = Object.keys(LABELS);

/** Above this a difference is worth reading; below it, it is noise. */
const MEANINGFUL = 0.15;
/** Whole rows, and a count of what is left — a half-clipped row reads as a bug. */
const SHOWN = 6;

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const strong = Math.abs(value) >= MEANINGFUL;
  return (
    <span className={cn("tnum", strong ? "text-foreground font-semibold" : "text-muted-foreground")}>
      {value > 0 ? "+" : ""}
      {value.toFixed(3)}
    </span>
  );
}

/**
 * The gist is the first sentence from the embedding cache, and the splitter
 * sometimes cuts one short — "I was encouraged via DISPATCH to bring this
 * discussion to the agent2agent" ends there. Mark the fragment rather than
 * present it as a whole sentence; fixing the splitter means re-embedding the
 * corpus, and a visible ellipsis is honest in the meantime.
 */
function gistOf(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?:]$/.test(trimmed) ? trimmed : `${trimmed}…`;
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
        {gistOf(m.gist) || m.message_id.slice(0, 60)} ↗
      </a>
      <div className="text-muted-foreground tnum mt-0.5 text-[11px]">
        {m.sent_at?.slice(0, 10) ?? "—"} · {m.replies_from_standing} repl
        {m.replies_from_standing === 1 ? "y" : "ies"} from standing · thread of{" "}
        {m.thread_messages}
      </div>
    </li>
  );
}

export function ContributionCard({ data }: { data: Contribution[] }) {
  if (data.length === 0) return null;

  // A property replicates when it clears the threshold on every list *in the
  // same direction*. Anything that moves on one list only is what a
  // few-dozen-reply sample does, not a second finding — so the callout is
  // derived from the table rather than written next to it, and it changes when
  // the numbers do.
  const replicates = ORDER.filter((key) =>
    data.every((d) => {
      const delta = d.what_works[key]?.delta;
      return delta !== null && delta !== undefined && Math.abs(delta) >= MEANINGFUL;
    }) &&
    new Set(data.map((d) => Math.sign(d.what_works[key]?.delta ?? 0))).size === 1,
  );
  const singleList = ORDER.filter(
    (key) =>
      !replicates.includes(key) &&
      data.some((d) => Math.abs(d.what_works[key]?.delta ?? 0) >= MEANINGFUL),
  );
  const name = (key: string) => LABELS[key]!.toLowerCase();

  return (
    <Card className="mt-6" data-review="contribution">
      <CardHeader>
        <CardTitle className="text-base">What draws a reply from someone with standing</CardTitle>
        <CardDescription>
          Cliff&apos;s delta between the replies that drew one and the replies that did
          not: 0 is no difference, ±1 is complete separation. Both lists side by side,
          never pooled.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-background">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-semibold">Property of the reply</th>
                {data.map((d) => (
                  <th key={d.list_name} className="px-3 py-2 text-right font-semibold">
                    {d.list_name}
                    <span className="text-muted-foreground block text-[11px] font-normal">
                      {d.replies_that_drew_standing_engagement} of {d.replies_examined} replies
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ORDER.map((key) => {
                const present = data.some((d) => d.what_works[key]);
                if (!present) return null;
                const isIdentity = key === "author_already_had_standing";
                return (
                  <tr key={key} className={cn("border-b last:border-0", isIdentity && "bg-muted/40")}>
                    <td className={cn("px-3 py-2", isIdentity && "font-medium")}>{LABELS[key]}</td>
                    {data.map((d) => (
                      <td key={d.list_name} className="px-3 py-2 text-right">
                        <Delta value={d.what_works[key]?.delta ?? null} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {replicates.length > 0 && (
          <div className="mt-3 rounded-md border border-l-[3px] border-l-[var(--warn)] bg-[var(--warn-bg)] p-3 text-xs">
            <strong className="text-[var(--warn)]">
              {replicates.length === 1
                ? `Only one property clears ${MEANINGFUL} on both lists: ${name(replicates[0]!)}.`
                : `${replicates.length} properties clear ${MEANINGFUL} on both lists: ${replicates
                    .map(name)
                    .join(" and ")}.`}
            </strong>{" "}
            {replicates.includes("author_already_had_standing") && (
              <>
                One of them is not a property of the message at all — it is who sent it.{" "}
              </>
            )}
            {singleList.length > 0 && (
              <>
                {singleList.length} more — {singleList.map(name).join(", ")} — move on one list and not
                the other, which is what{" "}
                {Math.min(...data.map((d) => d.replies_examined))} replies buys you.{" "}
              </>
            )}
            This is a statement about the lists, not about any participant.
          </div>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {data.map((d) => (
            <div key={d.list_name}>
              <h3 className="text-sm font-semibold">
                Buried <span className="text-muted-foreground font-normal">— {d.list_name}</span>
              </h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Drew a reply from someone the group listens to, inside a thread of{" "}
                {d.quiet_thread_threshold} messages or fewer.
              </p>
              <ul className="mt-2">
                {d.buried.slice(0, SHOWN).map((m) => (
                  <MessageRow key={m.message_id} m={m} list={d.list_name} />
                ))}
                {d.buried.length === 0 && (
                  <li className="text-muted-foreground py-2 text-xs italic">None found.</li>
                )}
              </ul>
              {d.buried.length > SHOWN && (
                <p className="text-muted-foreground mt-1 text-[11px]">
                  and {d.buried.length - SHOWN} more
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {data.map((d) => (
            <div key={d.list_name}>
              <h3 className="text-sm font-semibold">
                Newcomers who landed it{" "}
                <span className="text-muted-foreground font-normal">— {d.list_name}</span>
              </h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                A participant&apos;s <em>first</em> message that drew a reply from an
                account with standing. Worked examples.
              </p>
              <ul className="mt-2">
                {d.newcomer_wins.slice(0, SHOWN).map((m) => (
                  <MessageRow key={m.message_id} m={m} list={d.list_name} />
                ))}
                {d.newcomer_wins.length === 0 && (
                  <li className="text-muted-foreground py-2 text-xs italic">None found.</li>
                )}
              </ul>
              {d.newcomer_wins.length > SHOWN && (
                <p className="text-muted-foreground mt-1 text-[11px]">
                  and {d.newcomer_wins.length - SHOWN} more
                </p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
