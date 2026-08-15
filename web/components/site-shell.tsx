import Link from "next/link";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Page chrome shared by every page. The experimental banner and the
 * does-not-detect-provenance disclaimer live here rather than in each page, so
 * a page cannot omit them by being forgotten.
 */
export function SiteShell({
  title,
  lede,
  active,
  nav,
  banner,
  children,
  footer,
}: {
  title: string;
  lede: string;
  active: string;
  nav: { href: string; label: string }[];
  banner?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[92rem] px-5 pb-24">
      <header className="pt-8 pb-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <ThemeToggle />
        </div>
        <p className="text-muted-foreground mt-1 max-w-[70ch]">{lede}</p>
        {nav.length > 0 && (
          <nav className="mt-3 flex gap-4 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "text-primary hover:underline",
                  item.href === active && "font-semibold underline",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      {banner}
      {children}
      {footer && (
        <footer className="text-muted-foreground mt-12 border-t pt-4 text-sm">{footer}</footer>
      )}
    </div>
  );
}

export function Banner({
  tone = "warn",
  children,
}: {
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "my-4 rounded-md border border-l-[3px] px-4 py-3 text-sm",
        tone === "warn" && "bg-[var(--warn-bg)] border-l-[var(--warn)]",
      )}
    >
      {children}
    </div>
  );
}

export const PUBLIC_NAV = [
  { href: "/", label: "Overview" },
  { href: "/threads/", label: "Threads" },
  { href: "/accuracy/", label: "Accuracy" },
  { href: "/methodology/", label: "Methodology" },
];

export function ExperimentalBanner() {
  return (
    <Banner>
      <strong className="text-[var(--warn)]">Experimental.</strong> A personal research
      project by Orie Steele. Not an IETF product, not a working group deliverable, and
      not a statement made in any chair capacity. Nothing here represents IETF consensus.
      It does <strong>not</strong> detect AI-generated text: provenance is out of scope
      and is never formed, stored, or published.
    </Banner>
  );
}
