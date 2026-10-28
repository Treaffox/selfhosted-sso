import { NextResponse, type NextRequest } from "next/server";
import { clearGuestCookie, destroySession, getGuestTokenFromRequest } from "@/lib/session";
import { endGuestAccess } from "@/lib/guest-access";
import { logAudit } from "@/lib/audit";
import { getPublicBaseUrl } from "@/lib/avatar";

// Redirect target comes from configuration, not from request headers
function getBaseUrl(request: NextRequest): string {
  return getPublicBaseUrl() || request.url;
}

async function logout(request: NextRequest) {
  await logAudit("LOGOUT"); // before destroying: the actor is resolved from the session cookie
  await destroySession();
  // A guest signing out ends the guest access of this browser as well
  await endGuestAccess(getGuestTokenFromRequest(request));
  await clearGuestCookie();
  return NextResponse.redirect(new URL("/auth/login", getBaseUrl(request)));
}

export const POST = logout;
export const GET = logout;
