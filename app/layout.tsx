import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChangeGraph — understand code before reviewing changes",
  description:
    "A graph-first workspace for understanding existing code and then reviewing every changed line against that baseline.",
  openGraph: {
    title: "ChangeGraph — understand code before reviewing changes",
    description:
      "Map existing code, then explain every changed line against that baseline.",
    images: [
      {
        url: "/changegraph-og-v2.png",
        width: 1664,
        height: 960,
        alt: "A colorful semantic map showing connected code concepts and an exact before-to-after change",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ChangeGraph — understand code before reviewing changes",
    description:
      "Map existing code, then explain every changed line against that baseline.",
    images: ["/changegraph-og-v2.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
