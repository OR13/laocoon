import { tidySubject } from "@/lib/graph-model";
import { cn } from "@/lib/utils";
import type { ListedThread } from "@/lib/threads";

/**
 * One insight per section.
 *
 * The page this replaces stacked nine cards of equal weight, several of them
 * tables — a 7×3 delta grid, a 3-axis spread, a share table — and the operator
 * read it as being overwhelmed rather than informed. Every section here
 * answers one question, leads with the number that answers it, and links to
 * the messages behind it. Nothing is a table unless a reader would actually
 * scan down a column.
 */

export function Section({
  id,
  question,
  children,
}: {
  id: string;
  question: string;
  children: React.ReactNode;
}) {
  return (
    <section data-review={id} className="border-t py-10 first:border-t-0">
      <h2 className="mb-4 text-xl font-semibold tracking-tight">{question}</h2>
      {children}
    </section>
  );
}

/** The one number a section is about. */
export function Headline({
  value,
  of,
  caption,
}: {
  value: string;
  of?: string;
  caption: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="tnum text-5xl leading-none font-semibold tracking-tight">{value}</span>
      {of && <span className="text-muted-foreground tnum text-lg">of {of}</span>}
      <p className="text-muted-foreground min-w-[16rem] flex-1 text-sm">{caption}</p>
    </div>
  );
}

/** A proportion, as one bar the width of the page. Reads at a glance. */
export function SplitBar({
  parts,
}: {
  parts: { label: string; value: number; token: string; help?: string }[];
}) {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-md border">
        {parts.map((p, i) => (
          <div
            key={p.label}
            title={p.help ?? p.label}
            style={{ width: `${(p.value / total) * 100}%`, background: `var(${p.token})` }}
            className={cn("h-full", i > 0 && "border-l-2 border-[var(--card)]")}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5">
            <i
              className="inline-block size-3 shrink-0 rounded-[3px]"
              style={{ background: `var(${p.token})` }}
            />
            <span className="text-foreground tnum font-medium">{p.value}</span>
            <span className="text-muted-foreground">{p.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A short list of threads. Never more than a handful, always linked.
 *
 * The alternative — and what was here — is a table of every thread with eight
 * numeric columns. A reader looking for "what should I go and read" does not
 * scan a column; they want a few named things and a way in.
 */
export function ThreadList({
  threads,
  empty,
  limit = 6,
}: {
  threads: ListedThread[];
  empty: string;
  limit?: number;
}) {
  if (threads.length === 0) {
    return <p className="text-muted-foreground py-2 text-sm italic">{empty}</p>;
  }
  return (
    <div>
      <ul className="divide-y">
        {threads.slice(0, limit).map((t) => (
          <li key={t.id} className="py-2.5">
            <div className="min-w-0 flex-1">
              <a
                href={t.href}
                target="_blank"
                rel="noreferrer"
                className="hover:text-primary text-sm hover:underline"
              >
                {tidySubject(t.subject)}
              </a>
              <div className="text-muted-foreground tnum mt-0.5 text-xs">
                {t.messages} message{t.messages === 1 ? "" : "s"} · {t.participants} participant
                {t.participants === 1 ? "" : "s"}
                {t.last_message_at && ` · ${t.last_message_at.slice(0, 10)}`}
                <span className="ml-1.5 tracking-wide uppercase opacity-70">{t.list_name}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {threads.length > limit && (
        <p className="text-muted-foreground mt-2 text-xs">
          and {threads.length - limit} more — the full list is on{" "}
          <a className="text-primary underline" href="/threads/">
            threads
          </a>
          .
        </p>
      )}
    </div>
  );
}
