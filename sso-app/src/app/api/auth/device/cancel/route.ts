import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";

/** POST: the waiting device gives up (back button). Body: { requestId, pollSecret } */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const requestId = typeof body?.requestId === "string" ? body.requestId.slice(0, 64) : "";
  const pollSecret = typeof body?.pollSecret === "string" ? body.pollSecret.slice(0, 128) : "";

  const r = requestId && pollSecret ? await db.deviceLoginRequest.findUnique({ where: { id: requestId } }) : null;
  if (r) {
    const given = Buffer.from(sha256(pollSecret));
    const stored = Buffer.from(r.pollHash);
    if (given.length === stored.length && crypto.timingSafeEqual(given, stored)) {
      // An approved request stays: the approval already happened and the owner was told so
      await db.deviceLoginRequest.deleteMany({ where: { id: r.id, status: "PENDING" } });
    }
  }
  return NextResponse.json({ success: true });
}
