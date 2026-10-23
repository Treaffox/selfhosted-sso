"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BrandLogo } from "@/components/ui/brand-logo";
import type { BrandView } from "@/lib/site-settings";
import { useT } from "@/components/i18n-provider";

interface HeaderProps {
  brand: BrandView;
  user?: { username: string; isMaster: boolean } | null;
}

export function Header({ brand, user }: HeaderProps) {
  const t = useT();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3">
          <BrandLogo brand={brand} className="h-6" />
          {brand.logoUrl && (
            <span className="text-xs font-black text-muted border-l border-border pl-3 uppercase tracking-widest">
              SSO
            </span>
          )}
        </Link>

        <div className="flex items-center gap-1">
          {/* Desktop Navigation */}
          {user && (
            <nav className="hidden sm:flex items-center gap-1">
              {user.isMaster && (
                <>
                  <NavLink href="/admin" current={pathname}>
                    {t("Dashboard")}
                  </NavLink>
                  <NavLink href="/admin/users" current={pathname}>
                    {t("Nutzer")}
                  </NavLink>
                  <NavLink href="/admin/apps" current={pathname}>
                    {t("Apps")}
                  </NavLink>
                  <NavLink href="/admin/audit" current={pathname}>
                    {t("Audit-Log")}
                  </NavLink>
                  <NavLink href="/admin/settings" current={pathname}>
                    {t("System")}
                  </NavLink>
                </>
              )}
              <NavLink href="/settings" current={pathname}>
                {t("Einstellungen")}
              </NavLink>
              <form action="/api/auth/logout" method="POST" className="ml-2">
                <button
                  type="submit"
                  className="text-xs font-bold text-muted hover:text-foreground transition-colors px-3 py-1.5"
                >
                  {t("Abmelden")}
                </button>
              </form>
            </nav>
          )}

          <ThemeToggle className="ml-1" />

          {/* Mobile Hamburger */}
          {user && (
            <button
              className="sm:hidden p-2 text-muted hover:text-foreground transition-colors"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={t("Menü")}
            >
              {menuOpen ? (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 5h14M3 10h14M3 15h14" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Mobile Menu */}
      {user && menuOpen && (
        <nav className="sm:hidden border-t border-border bg-surface px-4 py-3 space-y-1">
          {user.isMaster && (
            <>
              <MobileNavLink href="/admin" current={pathname} onClick={() => setMenuOpen(false)}>
                {t("Dashboard")}
              </MobileNavLink>
              <MobileNavLink href="/admin/users" current={pathname} onClick={() => setMenuOpen(false)}>
                {t("Nutzer")}
              </MobileNavLink>
              <MobileNavLink href="/admin/apps" current={pathname} onClick={() => setMenuOpen(false)}>
                {t("Apps")}
              </MobileNavLink>
              <MobileNavLink href="/admin/audit" current={pathname} onClick={() => setMenuOpen(false)}>
                {t("Audit-Log")}
              </MobileNavLink>
              <MobileNavLink href="/admin/settings" current={pathname} onClick={() => setMenuOpen(false)}>
                {t("System")}
              </MobileNavLink>
            </>
          )}
          <MobileNavLink href="/settings" current={pathname} onClick={() => setMenuOpen(false)}>
            {t("Einstellungen")}
          </MobileNavLink>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="w-full text-left text-xs font-bold text-muted hover:text-foreground transition-colors px-3 py-2 rounded-md"
            >
              {t("Abmelden")}
            </button>
          </form>
        </nav>
      )}
    </header>
  );
}

function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: string;
  children: React.ReactNode;
}) {
  const isActive = current === href || current.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={`text-xs font-bold px-3 py-1.5 rounded-md transition-colors ${
        isActive
          ? "text-foreground bg-surface-lighter"
          : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}

function MobileNavLink({
  href,
  current,
  children,
  onClick,
}: {
  href: string;
  current: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  const isActive = current === href || current.startsWith(href + "/");
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block text-xs font-bold px-3 py-2 rounded-md transition-colors ${
        isActive
          ? "text-foreground bg-surface-lighter"
          : "text-muted hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
