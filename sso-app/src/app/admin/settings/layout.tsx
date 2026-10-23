"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/i18n-provider";
import { N_ } from "@/lib/i18n/core";

const TABS = [
  { href: "/admin/settings", label: N_("Übersicht") },
  { href: "/admin/settings/appearance", label: N_("Erscheinungsbild") },
  { href: "/admin/settings/security", label: N_("Sicherheit") },
  { href: "/admin/settings/mail", label: N_("E-Mail") },
  { href: "/admin/settings/cloudflare", label: "Cloudflare" },
];

export default function SystemSettingsLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-black mb-4">{t("System")}</h1>
      <nav className="flex gap-1 overflow-x-auto border-b border-border mb-6 sm:mb-8 -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap text-sm font-bold px-4 py-2.5 -mb-px border-b-2 transition-colors ${
                active ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t(tab.label)}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
