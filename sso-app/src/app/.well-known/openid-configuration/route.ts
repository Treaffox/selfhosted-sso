import { NextResponse } from "next/server";
import { getOIDCConfiguration } from "@/lib/oidc";

export async function GET() {
  const config = getOIDCConfiguration();
  return NextResponse.json(config, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
