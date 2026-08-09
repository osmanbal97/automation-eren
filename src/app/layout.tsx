import type { Metadata } from "next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { getT } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Automation",
  description: "Personal AI video content pipeline",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getT();

  return (
    <html lang={locale}>
      <body className="antialiased">
        <LanguageSwitcher locale={locale} />
        {children}
      </body>
    </html>
  );
}
