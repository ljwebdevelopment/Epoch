import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Epoch — A Living Atlas of Rising and Falling Worlds",
  description:
    "Watch an alternate human history unfold across a hand-drawn fantasy world — kingdoms rise, faiths spread, wars rage, and ruins gather dust.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* Manuscript-flavoured type: engraved titles, garamond body, fell script. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Cinzel+Decorative:wght@700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=IM+Fell+English:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
