import { Footer } from "@/components/layout/footer";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { BrandLogo } from "@/components/ui/brand-logo";
import type { BrandView } from "@/lib/site-settings";

/** Centered card on the plain background with logo and footer, as used by the sign-in page. */
export function AuthShell({ brand, children }: { brand: BrandView; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="fixed top-4 right-4 z-10 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div className="flex-1 flex flex-col items-center px-4 pt-[max(2rem,12vh)] pb-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            <div className="flex justify-center mb-3">
              <BrandLogo brand={brand} className="h-8" />
            </div>
            {brand.tagline && <p className="text-xs text-muted uppercase tracking-[0.2em] font-bold">{brand.tagline}</p>}
          </div>
          <div className="bg-surface-light border border-border rounded-xl p-6">{children}</div>
        </div>
      </div>
      <Footer brand={brand} />
    </div>
  );
}
