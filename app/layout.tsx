import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Epoch — Watch Civilizations Rise and Fall",
  description:
    "An interactive civilization simulator. Watch thousands of tiny people build society over time.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
