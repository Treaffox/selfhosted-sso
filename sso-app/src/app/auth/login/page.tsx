import { effectivePermission } from "@/lib/guest-account";
import { needsMfaSetup } from "@/lib/mfa-policy";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { createAuthCode } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getPublicBaseUrl } from "@/lib/avatar";
import { isAllowedRedirectUri, safeReturnTo } from "@/lib/safe-redirect";
import { getBrandView } from "@/lib/site-settings";
import { getT } from "@/lib/i18n/server";
import { LoginForm } from "./login-form";
import { N_ } from "@/lib/i18n/core";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("Anmelden") };
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const appId = first(params.app_id);
  const redirectUri = first(params.redirect_uri);
  const state = first(params.state);
  // Only same-origin targets: this value ends up in a redirect (here and in the login form)
  const returnTo = safeReturnTo(first(params.returnTo), [new URL(getPublicBaseUrl()).origin]);

  const session = await getSession();

  if (session) {
    // Legacy OAuth-like flow (app_id/redirect_uri): silently re-authenticate
    // against the existing SSO session instead of showing the login form again.
    if (appId) {
      const app = await db.app.findUnique({ where: { id: appId } });

      if (app && app.isActive && session.user.forcePasswordChange) {
        // A temporary password has to be changed before any app is reachable (same rule as everywhere else)
        await logAudit("APP_ACCESS_DENIED", { protocol: "app-token", reason: N_("Passwortänderung erforderlich"), path: "/auth/login" }, session.userId, undefined, { appId: app.id, outcome: "DENIED", authVia: "EXISTING_SESSION" });
        redirect("/settings/security?changePassword=1");
      }

      if (app && app.isActive && (await needsMfaSetup(session.user))) {
        await logAudit("APP_ACCESS_DENIED", { protocol: "app-token", reason: N_("Zweiter Faktor erforderlich"), path: "/auth/login" }, session.userId, undefined, { appId: app.id, outcome: "DENIED", authVia: "EXISTING_SESSION" });
        redirect("/settings/security?setupMfa=1");
      }

      if (app && app.isActive) {
        const allowedUris: string[] = JSON.parse(app.redirectUris);
        let resolvedRedirectUri: string | undefined = redirectUri;
        if (!resolvedRedirectUri) {
          if (allowedUris.length > 0) resolvedRedirectUri = allowedUris[0];
        } else if (!isAllowedRedirectUri(allowedUris, resolvedRedirectUri)) {
          // Unregistered redirect_uri: refuse to silently redirect there.
          resolvedRedirectUri = undefined;
        }

        if (resolvedRedirectUri) {
          const permission = await db.userAppPermission.findUnique({
            where: { userId_appId: { userId: session.userId, appId: app.id } },
          });
          const permissionLevel = effectivePermission(permission?.permissionLevel, app.defaultPermission, session.user);

          if (permissionLevel === "DENY") {
            await logAudit("APP_ACCESS_DENIED", { protocol: "app-token", reason: N_("Berechtigung DENY"), path: "/auth/login" }, session.userId, undefined, { appId: app.id, outcome: "DENIED", authVia: "EXISTING_SESSION" });
            const errorUrl = new URL(resolvedRedirectUri);
            errorUrl.searchParams.set("error", "access_denied");
            errorUrl.searchParams.set("error_description", "User does not have permission");
            if (state) errorUrl.searchParams.set("state", state);
            redirect(errorUrl.toString());
          }

          const code = await createAuthCode(
            app.id,
            session.userId,
            permissionLevel,
            resolvedRedirectUri,
            state
          );

          const callbackUrl = new URL(resolvedRedirectUri);
          callbackUrl.searchParams.set("code", code);
          await logAudit(
            "APP_LOGIN",
            { protocol: "app-token", via: "EXISTING_SESSION", redirect: callbackUrl.origin + callbackUrl.pathname, permission: permissionLevel },
            session.userId,
            undefined,
            { appId: app.id, authVia: "EXISTING_SESSION" }
          );
          if (state) callbackUrl.searchParams.set("state", state);
          redirect(callbackUrl.toString());
        }
      }
      // Unknown app / inactive / no redirect URI available: fall through to
      // the normal login form so the user gets a visible error instead of a
      // silent dead end.
    } else if (returnTo) {
      redirect(returnTo);
    } else {
      redirect("/settings");
    }
  }

  return <LoginForm returnTo={returnTo} brand={await getBrandView()} />;
}
