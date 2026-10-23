import { NextResponse } from "next/server";
import { DEFAULT_FAVICON_SVG, getAsset, getMailLogoPng } from "@/lib/brand-assets";

/**
 * Public (no login): the login page, the favicon and e-mail clients need these images.
 * Uploaded SVGs are served sandboxed so they can never run script on our origin.
 */
const SAFE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

function cacheControl(request: Request): string {
  // The URL carries ?v=<upload time>, so a versioned URL never changes its content.
  return new URL(request.url).searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=300";
}

function image(request: Request, body: Buffer | string, type: string) {
  return new NextResponse(typeof body === "string" ? body : new Uint8Array(body), {
    headers: { ...SAFE_HEADERS, "Content-Type": type, "Cache-Control": cacheControl(request) },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;

  if (asset === "logo" || asset === "logo-light" || asset === "favicon") {
    const kind = asset === "logo-light" ? "logoLight" : asset;
    const stored = await getAsset(kind);
    if (stored) return image(request, stored.data, stored.mime);
    if (asset === "favicon") return image(request, DEFAULT_FAVICON_SVG, "image/svg+xml");
    return new NextResponse(null, { status: 404 });
  }

  if (asset === "mail-logo") {
    const onLight = new URL(request.url).searchParams.get("bg") === "light";
    const png = await getMailLogoPng(onLight);
    return png ? image(request, png, "image/png") : new NextResponse(null, { status: 404 });
  }

  return new NextResponse(null, { status: 404 });
}
