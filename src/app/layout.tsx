import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Automation",
  description: "Personal AI video content pipeline",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
