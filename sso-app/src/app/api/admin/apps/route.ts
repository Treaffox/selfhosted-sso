import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { generateAppToken, logAudit } from "@/lib/auth";
import { appNameSchema, redirectUriSchema, permissionLevelSchema } from "@/lib/validation";
import { getClientIp } from "@/lib/ip";

/** GET: List all apps (master only). */
export async function GET() {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const apps = await db.app.findMany({
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      permissionLevels: true,
      defaultPermission: true,
      isActive: true,
      redirectUris: true,
      createdAt: true,
      _count: { select: { permissions: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(
    apps.map((app) => ({
      ...app,
      permissionLevels: JSON.parse(app.permissionLevels),
      redirectUris: JSON.parse(app.redirectUris),
    }))
  );
}

/** POST: Create a new app (master only). Returns the app token ONCE. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { name, redirectUris, permissionLevels, defaultPermission } = body;

    // Validate name
    const nameResult = appNameSchema.safeParse(name);
    if (!nameResult.success) {
      return NextResponse.json({ error: nameResult.error.issues[0].message }, { status: 400 });
    }

    // Validate redirect URIs (optional)
    const uris = Array.isArray(redirectUris) ? redirectUris.filter(Boolean) : [];
    for (const uri of uris) {
      const uriResult = redirectUriSchema.safeParse(uri);
      if (!uriResult.success) {
        return NextResponse.json({ error: `Ungültige URI: ${uriResult.error.issues[0].message}` }, { status: 400 });
      }
    }

    // Validate permission levels
    const levels = permissionLevels ?? ["ALLOW", "DENY"];
    if (!Array.isArray(levels)) {
      return NextResponse.json({ error: "permissionLevels muss ein Array sein" }, { status: 400 });
    }
    // Ensure ALLOW and DENY are always present
    if (!levels.includes("ALLOW")) levels.unshift("ALLOW");
    if (!levels.includes("DENY")) levels.splice(1, 0, "DENY");

    for (const level of levels) {
      const lvlResult = permissionLevelSchema.safeParse(level);
      if (!lvlResult.success) {
        return NextResponse.json({ error: `Ungültiger Level: ${level}` }, { status: 400 });
      }
    }

    // Validate default permission
    const defPerm = defaultPermission ?? "DENY";
    if (!levels.includes(defPerm)) {
      return NextResponse.json({ error: "Default-Berechtigung muss im Level-Array enthalten sein" }, { status: 400 });
    }

    // Generate token
    const { token, hash, prefix } = generateAppToken();

    const app = await db.app.create({
      data: {
        name: nameResult.data,
        tokenHash: hash,
        tokenPrefix: prefix,
        redirectUris: JSON.stringify(uris),
        permissionLevels: JSON.stringify(levels),
        defaultPermission: defPerm,
      },
    });

    await logAudit(
      "APP_CREATED",
      { appId: app.id, name: app.name },
      session.user.id,
      getClientIp(request)
    );

    // Return token ONCE – it can never be retrieved again
    return NextResponse.json(
      {
        success: true,
        app: { id: app.id, name: app.name },
        token, // ⚠️ Show only once!
        tokenPrefix: prefix,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[CREATE APP ERROR]", error);
    return NextResponse.json({ error: "Fehler beim Erstellen" }, { status: 500 });
  }
}
