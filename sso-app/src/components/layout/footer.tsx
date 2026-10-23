"use client";

import type { BrandView } from "@/lib/site-settings";
import { useT } from "@/components/i18n-provider";

export function Footer({ brand }: { brand: BrandView }) {
  const t = useT();
  const links = brand.contactUrl && !brand.footerLinks.some((l) => l.url === brand.contactUrl)
    ? [...brand.footerLinks, { label: t("Kontakt"), url: brand.contactUrl }]
    : brand.footerLinks;

  return (
    <footer className="border-t border-border mt-auto py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        {links.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted">
            {links.map((link) => (
              <a key={`${link.label}${link.url}`} href={link.url} className="hover:text-foreground transition-colors">
                {link.label}
              </a>
            ))}
          </div>
        )}
        {brand.copyright && <p className={`text-center text-xs text-muted/60 ${links.length > 0 ? "mt-4" : ""}`}>{brand.copyright}</p>}
      </div>
    </footer>
  );
}
