import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";

/**
 * Public profile picture endpoint, so third-party apps can embed it via <img>.
 * The URL is versioned with ?v=<avatarUpdatedAt>, hence long-lived caching is safe.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const avatar = await db.userAvatar.findUnique({ where: { userId } });
  if (!avatar) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(avatar.data), {
    headers: {
      "Content-Type": avatar.mime,
      "Content-Length": String(avatar.data.length),
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
