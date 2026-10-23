import { isIP } from "net";

/**
 * Client IP behind the nginx reverse proxy.
 *
 * nginx sets `X-Real-IP` to `$remote_addr` and overwrites whatever the client sent, so it is the trusted source.
 * `X-Forwarded-For` may carry client-supplied entries at the FRONT (nginx only appends), so the fallback uses the
 * LAST entry – the one our own proxy added – never the first.
 */
export function clientIpFromHeaders(get: (name: string) => string | null | undefined): string | undefined {
  const real = get("x-real-ip")?.trim();
  if (real && isIP(real)) return real;

  const last = get("x-forwarded-for")?.split(",").pop()?.trim();
  if (last && isIP(last)) return last;

  return undefined;
}
