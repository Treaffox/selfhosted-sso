import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { generateAppToken, logAudit } from "@/lib/auth";
import { generateClientCredentials } from "@/lib/oidc";
import { appNameSchema, redirectUriSchema, permissionLevelSchema } from "@/lib/validation";
import { getClientIp } from "@/lib/ip";

/** GET: Get app details (master only). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const { id } = await params;

  const app = await db.app.findUnique({
    where: { id },
    include: {
      permissions: {
        select: {
          id: true,
          permissionLevel: true,
          user: { select: { id: true, username: true } },
        },
      },
    },
  });

  if (!app) {
    return NextResponse.json({ error: "App nicht gefunden" }, { status: 404 });
  }

  // The credential hashes never leave the server (the UI only needs the prefixes)
  const { tokenHash: _tokenHash, clientSecret: _clientSecret, ...safe } = app;
  return NextResponse.json({
    ...safe,
    permissionLevels: JSON.parse(app.permissionLevels),
    redirectUris: JSON.parse(app.redirectUris),
    allowedScopes: app.allowedScopes ? JSON.parse(app.allowedScopes) : ["openid", "profile", "email"],
  });
}

/** PATCH: Update app (master only). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    }
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const r = appNameSchema.safeParse(body.name);
      if (!r.success) return NextResponse.json({ error: r.error.issues[0].message }, { status: 400 });
      updates.name = r.data;
    }

    if (body.redirectUris !== undefined) {
      const uris = Array.isArray(body.redirectUris) ? body.redirectUris.filter(Boolean) : [];
      for (const uri of uris) {
        const r = redirectUriSchema.safeParse(uri);
        if (!r.success) return NextResponse.json({ error: r.error.issues[0].message }, { status: 400 });
      }
      updates.redirectUris = JSON.stringify(uris);
    }

    // Resolve the level list this request ends up with, to validate defaultPermission against it
    let effectiveLevels: string[] | null = null;

    if (body.permissionLevels !== undefined) {
      const levels = body.permissionLevels;
      if (!Array.isArray(levels)) return NextResponse.json({ error: "Array erwartet" }, { status: 400 });
      if (!levels.includes("ALLOW")) levels.unshift("ALLOW");
      if (!levels.includes("DENY")) levels.splice(1, 0, "DENY");
      for (const level of levels) {
        if (!permissionLevelSchema.safeParse(level).success) {
          return NextResponse.json({ error: `Ungültiger Level: ${String(level)}` }, { status: 400 });
        }
      }
      updates.permissionLevels = JSON.stringify(levels);
      effectiveLevels = levels;

      // The default level must stay in the list
      if (body.defaultPermission === undefined) {
        const current = await db.app.findUnique({ where: { id }, select: { defaultPermission: true } });
        if (current && !levels.includes(current.defaultPermission)) {
          return NextResponse.json({ error: "Das Standard-Level kann nicht entfernt werden – wähle zuerst ein anderes" }, { status: 400 });
        }
      }
    }

    if (body.defaultPermission !== undefined) {
      if (typeof body.defaultPermission !== "string") {
        return NextResponse.json({ error: "Ungültige Default-Berechtigung" }, { status: 400 });
      }
      if (!effectiveLevels) {
        const current = await db.app.findUnique({ where: { id }, select: { permissionLevels: true } });
        effectiveLevels = current ? (JSON.parse(current.permissionLevels) as string[]) : [];
      }
      if (!effectiveLevels.includes(body.defaultPermission)) {
        return NextResponse.json({ error: "Default-Berechtigung muss im Level-Array enthalten sein" }, { status: 400 });
      }
      updates.defaultPermission = body.defaultPermission;
    }

    if (body.isActive !== undefined) {
      updates.isActive = !!body.isActive;
    }

    if (body.oidcEnabled !== undefined) {
      updates.oidcEnabled = !!body.oidcEnabled;
    }

    // Regenerate token
    if (body.regenerateToken) {
      const { token, hash, prefix } = generateAppToken();
      updates.tokenHash = hash;
      updates.tokenPrefix = prefix;

      await db.app.update({ where: { id }, data: updates });

      await logAudit("APP_TOKEN_REGENERATED", { appId: id }, session.user.id, getClientIp(request));

      return NextResponse.json({ success: true, token, tokenPrefix: prefix });
    }

    // Generate or regenerate OIDC client credentials
    if (body.generateOidcCredentials) {
      const { clientId, clientSecret, secretHash, secretPrefix } = generateClientCredentials();
      await db.app.update({
        where: { id },
        data: {
          clientId,
          clientSecret: secretHash,
          clientSecretPrefix: secretPrefix,
          clientType: body.clientType === "public" ? "public" : "confidential",
        },
      });

      await logAudit("APP_OIDC_CREDENTIALS_GENERATED", { appId: id }, session.user.id, getClientIp(request));

      return NextResponse.json({ success: true, clientId, clientSecret, clientSecretPrefix: secretPrefix });
    }

    // Update client type
    if (body.clientType !== undefined) {
      updates.clientType = body.clientType === "public" ? "public" : "confidential";
    }

    if (Object.keys(updates).length > 0) {
      await db.app.update({ where: { id }, data: updates });
    }

    // Handle permission updates ({ userId, permissionLevel } assigns, { userId, remove: true } falls back to the app default)
    const touchedPermissions = Array.isArray(body.permissions) && body.permissions.length > 0;
    if (body.permissions && Array.isArray(body.permissions)) {
      const app = await db.app.findUnique({ where: { id }, select: { permissionLevels: true } });
      const allowed: string[] = app ? JSON.parse(app.permissionLevels) : [];
      for (const perm of body.permissions) {
        if (!perm.userId) continue;
        if (perm.remove) {
          await db.userAppPermission.deleteMany({ where: { userId: String(perm.userId), appId: id } });
          continue;
        }
        if (!perm.permissionLevel) continue;
        if (!allowed.includes(perm.permissionLevel)) {
          return NextResponse.json({ error: `Ungültiger Level: ${String(perm.permissionLevel)}` }, { status: 400 });
        }
        await db.userAppPermission.upsert({
          where: { userId_appId: { userId: perm.userId, appId: id } },
          create: { userId: perm.userId, appId: id, permissionLevel: perm.permissionLevel },
          update: { permissionLevel: perm.permissionLevel },
        });
      }
    }

    await logAudit(
      "APP_UPDATED",
      { appId: id, fields: touchedPermissions ? [...Object.keys(updates), "permissions"] : Object.keys(updates) },
      session.user.id,
      getClientIp(request)
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
    console.error("[UPDATE APP ERROR]", error instanceof Error ? error.name : "unbekannter Fehler");
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}

/** DELETE: Delete app (master only). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  const { id } = await params;

  await db.app.delete({ where: { id } });
  await logAudit("APP_DELETED", { appId: id }, session.user.id, getClientIp(request));

  return NextResponse.json({ success: true });
}
