// Einfacher In-Memory-Rate-Limiter (bewusst ohne DB).
// Wird bei Cold-Start zurückgesetzt – Turnstile/Session bleiben die primäre Hürde.

import type { NextRequest } from "next/server";

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit = 5, windowMs = 60_000) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true as const };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false as const, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true as const };
}
