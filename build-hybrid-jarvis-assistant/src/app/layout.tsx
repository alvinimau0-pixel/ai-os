import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "J.A.R.V.I.S. — Hybrid AI Assistant",
  description:
    "A hybrid voice-enabled AI assistant: an offline local skill core plus an optional cloud brain with tool-calling.",
};

export const viewport: Viewport = {
  themeColor: "#02070f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-deep text-ink antialiased">{children}</body>
    </html>
  );
}
