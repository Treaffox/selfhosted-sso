import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { hashPassword, generateAppToken, createRecoveryCodes, logAudit } from "@/lib/auth";
import { usernameSchema, passwordSchema, emailSchema } from "@/lib/validation";
import { getClientIp } from "@/lib/ip";
import { sendWelcomeEmail } from "@/lib/email";

/** GET: List all users (master only). */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const users = await db.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      isMaster: true,
      forcePasswordChange: true,
      totpVerified: true,
      createdAt: true,
      _count: { select: { passkeys: true, sessions: true } },
      permissions: {
        select: {
          permissionLevel: true,
          app: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(users);
}

/** POST: Create a new user (master only). */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { username, password, email } = body;

    // Validate
    const uResult = usernameSchema.safeParse(username);
    if (!uResult.success) {
      return NextResponse.json({ error: uResult.error.issues[0].message }, { status: 400 });
    }

    const pResult = passwordSchema.safeParse(password);
    if (!pResult.success) {
      return NextResponse.json({ error: pResult.error.issues[0].message }, { status: 400 });
    }

    if (email) {
      const eResult = emailSchema.safeParse(email);
      if (!eResult.success) {
        return NextResponse.json({ error: eResult.error.issues[0].message }, { status: 400 });
      }
    }

    // Check uniqueness
    const existing = await db.user.findUnique({ where: { username: uResult.data } });
    if (existing) {
      return NextResponse.json({ error: "Benutzername bereits vergeben" }, { status: 409 });
    }

    const passwordHash = await hashPassword(pResult.data);

    const user = await db.user.create({
      data: {
        username: uResult.data,
        passwordHash,
        email: email || null,
        forcePasswordChange: true,
      },
    });

    // Generate recovery codes
    await createRecoveryCodes(user.id);

    await logAudit(
      "USER_CREATED",
      { username: user.username, createdBy: session.user.username },
      session.user.id,
      getClientIp(request)
    );

    // Send welcome email if email provided
    if (email) {
      sendWelcomeEmail(email, username, password).catch(() => {});
    }

    return NextResponse.json({ success: true, user: { id: user.id, username: user.username } }, { status: 201 });
  } catch (error) {
    console.error("[CREATE USER ERROR]", error);
    return NextResponse.json({ error: "Fehler beim Erstellen" }, { status: 500 });
  }
}
