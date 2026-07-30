import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f2f5f1",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "COVID Point Process Lab";
  const description =
    "Learn counting processes, intensity estimation, Poisson models, diagnostics, and simulation with The New York Times COVID-19 archive.";

  return {
    metadataBase: new URL(origin),
    title,
    description,
    icons: {
      icon: "/favicon-v2.png",
      shortcut: "/favicon-v2.png",
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: origin,
      images: [
        {
          url: `${origin}/og-v2.png`,
          width: 1734,
          height: 907,
          alt: "COVID Point Process Lab — Observe, fit, simulate, and diagnose.",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${origin}/og-v2.png`],
    },
  };
}

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
