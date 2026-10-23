import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { getBrandView } from "@/lib/site-settings";
import { getLocale, messagesFor } from "@/lib/i18n/server";
import { I18nProvider } from "@/components/i18n-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrandView();
  return {
    title: { default: brand.siteName, template: `%s | ${brand.siteName}` },
    applicationName: brand.siteName,
    description: `${brand.siteName}${brand.tagline ? ` – ${brand.tagline}` : ""}`,
    icons: { icon: brand.faviconUrl },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('sso-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();",
          }}
        />
      </head>
      <body className="font-sans font-semibold antialiased">
        <I18nProvider locale={locale} messages={messagesFor(locale)}>
          {children}
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  );
}
