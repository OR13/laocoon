import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ThreadLanguage } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * What the messages themselves contain, and how tied they are to their thread.
 *
 * These two replaced a classifier that returned `substantive` for 162 of 164
 * replies. Both are computed rather than judged, and both were built because
 * the measures already here could not see what the operator was describing:
 * novelty is distance from what the thread already said, so fluent filler
 * scores *high* on it.
 *
 * **Neither is a provenance signal.** A person writing list-general prose that
 * cites nothing scores exactly the same as anything else writing it. What is
 * measured is what a message offers the discussion.
 */

/** A share, as a bar plus its number. Higher is not better; it depends. */
function Share({ value, tone }: { value: number; tone: "neutral" | "warn" }) {
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex w-full items-center justify-end gap-2">
      <span className="bg-border relative h-[6px] w-20 overflow-hidden rounded-sm">
        <span
          className={cn("absolute inset-y-0 left-0", tone === "warn" ? "bg-[var(--warn)]" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tnum w-9 text-right text-xs">{pct}%</span>
    </span>
  );
}

const ROWS: {
  key: "with_any_referent" | "offers_nothing_checkable" | "not_more_like_own_thread";
  label: string;
  help: string;
  tone: "neutral" | "warn";
}[] = [
  {
    key: "with_any_referent",
    label: "Cites something checkable",
    help: "Names a draft, an RFC, a section, a URL or a block of code.",
    tone: "neutral",
  },
  {
    key: "offers_nothing_checkable",
    label: "Offers nothing to check",
    help:
      "Over 40 words, and cites nothing, contests nothing and asks nothing. " +
      "Short acknowledgements are excluded — a brief “yes, that works” is a normal thing to send.",
    tone: "warn",
  },
  {
    key: "not_more_like_own_thread",
    label: "Would read as well in another thread",
    help:
      "No closer in vocabulary to its own thread than to the rest of the list. " +
      "A model was asked this and answered “no” for every message on both lists; this is computed instead.",
    tone: "warn",
  },
];

export function LanguageCard({ data }: { data: ThreadLanguage[] }) {
  if (data.length === 0) return null;

  return (
    <Card className="mt-6" data-review="language">
      <CardHeader>
        <CardTitle className="text-base">What the messages say</CardTitle>
        <CardDescription>
          Two measures of a message&apos;s text: what it points at that a reader could go
          and check, and how much its vocabulary belongs to the thread it was sent to.
          Counted over authored text only, so a reply never inherits the citations in the
          message it quotes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-background">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-semibold">Share of messages</th>
                {data.map((d) => (
                  <th key={d.list_name} className="px-3 py-2 text-right font-semibold">
                    {d.list_name}
                    <span className="text-muted-foreground block text-[11px] font-normal">
                      {d.distribution.messages} messages
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="px-3 py-2" title={row.help}>
                    {row.label}
                  </td>
                  {data.map((d) => (
                    <td key={d.list_name} className="px-3 py-2 text-right">
                      <Share value={d.distribution[row.key]} tone={row.tone} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground mt-3 max-w-[78ch] text-xs">
          None of these predicts whether an established account replies — checked, and
          reported in the table above. They describe what is being written, which is a
          different question from who gets answered.
        </p>
      </CardContent>
    </Card>
  );
}
