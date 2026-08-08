import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ChangeGraph — understand every changed line",
  description: "A graph-first review interface for understanding large AI-generated code changes line by line.",
  openGraph: {
    title: "ChangeGraph — understand every changed line",
    description: "A graph-first review interface for large AI-generated code changes.",
    images: [{ url: "/changegraph-og.png", width: 1664, height: 960, alt: "Semantic code changes shown as a directed graph" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ChangeGraph — understand every changed line",
    description: "A graph-first review interface for large AI-generated code changes.",
    images: ["/changegraph-og.png"],
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
