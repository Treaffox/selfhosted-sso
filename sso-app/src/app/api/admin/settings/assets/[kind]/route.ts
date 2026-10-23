import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/auth";
import { getClientIp } from "@/lib/ip";
import { ASSET_KINDS, ASSET_LABELS, checkAsset, deleteAsset, saveAsset } from "@/lib/brand-assets";
import type { AssetKind } from "@/lib/site-settings";

type Ctx = { params: Promise<{ kind: string }> };

function parseKind(kind: string): AssetKind | null {
  return (ASSET_KINDS as string[]).includes(kind) ? (kind as AssetKind) : null;
}

/** PUT multipart (field "file"): upload logo / light logo / favicon (master only). */
export async function PUT(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const kind = parseKind((await params).kind);
  if (!kind) return NextResponse.json({ error: "Unbekannte Bildart" }, { status: 404 });

  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Keine Datei übermittelt" }, { status: 400 });
    if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: "Datei ist zu groß" }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const check = await checkAsset(kind, buf);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    await saveAsset(kind, check.data, check.mime);
    await logAudit("BRANDING_ASSET_UPDATED", { kind, label: ASSET_LABELS[kind], mime: check.mime, bytes: check.data.length }, session.user.id, getClientIp(request));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ASSET UPLOAD ERROR]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Fehler" }, { status: 500 });
  }
}

/** DELETE: back to the built-in default (master only). */
export async function DELETE(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user.isMaster) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  const kind = parseKind((await params).kind);
  if (!kind) return NextResponse.json({ error: "Unbekannte Bildart" }, { status: 404 });

  await deleteAsset(kind);
  await logAudit("BRANDING_ASSET_UPDATED", { kind, label: ASSET_LABELS[kind], removed: true }, session.user.id, getClientIp(request));
  return NextResponse.json({ success: true });
}
