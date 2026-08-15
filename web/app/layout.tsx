import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LAOCOÖN",
  description:
    "Structural engagement measures for IETF mailing list discussions. Does not detect AI-generated text.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
