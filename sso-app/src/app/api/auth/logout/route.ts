import { NextResponse, type NextRequest } from "next/server";
import { destroySession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { getPublicBaseUrl } from "@/lib/avatar";

// Redirect target comes from configuration, not from request headers
function getBaseUrl(request: NextRequest): string {
  return getPublicBaseUrl() || request.url;
}

export async function POST(request: NextRequest) {
  await logAudit("LOGOUT"); // before destroying: the actor is resolved from the session cookie
  await destroySession();
  return NextResponse.redirect(new URL("/auth/login", getBaseUrl(request)));
}

export async function GET(request: NextRequest) {
  await logAudit("LOGOUT"); // before destroying: the actor is resolved from the session cookie
  await destroySession();
  return NextResponse.redirect(new URL("/auth/login", getBaseUrl(request)));
}
