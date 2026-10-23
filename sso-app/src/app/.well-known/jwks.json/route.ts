import { NextResponse } from "next/server";
import { getJWKS } from "@/lib/oidc";

export async function GET() {
  const jwks = await getJWKS();
  return NextResponse.json(jwks, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
