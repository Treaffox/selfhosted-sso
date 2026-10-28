import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAppUrl, getCookieDomain, getRpId, isHttpsDeployment } from "@/lib/config";
import { isCloudflareConfigured } from "@/lib/cloudflare";
import { getMailSettings, isMailConfigured } from "@/lib/mail/settings";
import { getAssetInfos, getSiteSettings } from "@/lib/site-settings";
import { describeGeoipDatabase } from "@/lib/geoip";

/** GET: setup checklist state + the server values that come from .env (master only). */
export async function GET() {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const [site, assets, mail, cloudflare, geoip] = await Promise.all([getSiteSettings(), getAssetInfos(), getMailSettings(), isCloudflareConfigured(), describeGeoipDatabase()]);
  const appUrl = getAppUrl();
  const host = new URL(appUrl).hostname;

  return NextResponse.json({
    checklist: {
      server: !/^(localhost|127\.|0\.0\.0\.0)/.test(host) && isHttpsDeployment(),
      branding: site.siteName !== "SSO" || !!assets.logo || !!assets.favicon,
      mail: isMailConfigured(mail),
      cloudflare,
      geoip: geoip.present,
    },
    server: {
      appUrl,
      https: isHttpsDeployment(),
      rpId: getRpId(),
      cookieDomain: getCookieDomain() ?? null,
      oidcIssuer: appUrl,
    },
  });
}
