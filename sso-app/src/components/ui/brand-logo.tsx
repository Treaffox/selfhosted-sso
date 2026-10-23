import type { BrandView } from "@/lib/site-settings";

/** The configured logo (theme aware), or the site name as text while none is uploaded. */
export function BrandLogo({ brand, className = "h-6" }: { brand: BrandView; className?: string }) {
  const size = `${className} w-auto max-w-[240px] object-contain`;
  if (!brand.logoUrl) {
    return <span className="text-base font-black tracking-tight text-foreground">{brand.siteName}</span>;
  }
  if (brand.logoLightUrl) {
    return (
      <>
        <img src={brand.logoUrl} alt={brand.siteName} className={`${size} brand-logo-dark`} />
        <img src={brand.logoLightUrl} alt={brand.siteName} className={`${size} brand-logo-light`} />
      </>
    );
  }
  return <img src={brand.logoUrl} alt={brand.siteName} className={`${size} brand-logo-auto`} />;
}
