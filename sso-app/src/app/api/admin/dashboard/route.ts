import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const [userCount, appCount, sessionCount, recentLogins] = await Promise.all([
    db.user.count(),
    db.app.count(),
    db.session.count({ where: { expiresAt: { gt: new Date() } } }),
    db.loginHistory.findMany({
      select: {
        id: true,
        ipAddress: true,
        success: true,
        method: true,
        createdAt: true,
        user: { select: { username: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return NextResponse.json({ userCount, appCount, sessionCount, recentLogins });
}
