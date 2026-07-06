// Zustandslose Session- und Magic-Link-Signierung (HMAC-SHA256 via Web Crypto).
// Läuft sowohl in der Middleware (Edge-Runtime) als auch in Node-Route-Handlern –
// daher bewusst ohne node:crypto/Buffer und ohne Abhängigkeit zu src/lib/jira.ts.

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
const MAGIC_LINK_MAX_AGE_MS = 15 * 60 * 1000; // 15 Minuten

export const SESSION_COOKIE_NAME = "wmc_session";
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_MS / 1000;

export interface SessionPayload {
  type: "session";
  email: string;
  isGuest: boolean;
  issuedAt: number;
  expiresAt: number;
}

export interface MagicLinkPayload {
  type: "magic-link";
  email: string;
  redirect: string;
  issuedAt: number;
  expiresAt: number;
}

function getSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET ?? "";
  if (!secret) throw new Error("Fehlende Umgebungsvariable: AUTH_SESSION_SECRET");
  return secret;
}

// Import des HMAC-Keys ist teuer genug, um ihn pro Isolate/Secret zu cachen.
let cachedKey: { secret: string; key: Promise<CryptoKey> } | null = null;
function getHmacKey(): Promise<CryptoKey> {
  const secret = getSecret();
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  cachedKey = { secret, key };
  return key;
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const b of arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sign(payload: unknown): Promise<string> {
  const dataB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataB64));
  return `${dataB64}.${toBase64Url(sig)}`;
}

async function verify<T>(token: string): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [dataB64, sigB64] = parts;
  try {
    const key = await getHmacKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(sigB64),
      new TextEncoder().encode(dataB64),
    );
    if (!valid) return null;
    return JSON.parse(new TextDecoder().decode(fromBase64Url(dataB64))) as T;
  } catch {
    return null;
  }
}

export async function signSession(params: { email: string; isGuest: boolean }): Promise<string> {
  const issuedAt = Date.now();
  const payload: SessionPayload = {
    type: "session",
    email: params.email,
    isGuest: params.isGuest,
    issuedAt,
    expiresAt: issuedAt + SESSION_MAX_AGE_MS,
  };
  return sign(payload);
}

export async function verifySessionCookie(value: string): Promise<SessionPayload | null> {
  const payload = await verify<SessionPayload>(value);
  if (!payload || payload.type !== "session") return null;
  if (Date.now() > payload.expiresAt) return null;
  return payload;
}

/** `redirect` muss ein interner Pfad sein (Absicherung gegen Open-Redirect über den Magic-Link). */
export async function signMagicLinkToken(params: { email: string; redirect: string }): Promise<string> {
  const issuedAt = Date.now();
  const payload: MagicLinkPayload = {
    type: "magic-link",
    email: params.email,
    redirect: params.redirect.startsWith("/") ? params.redirect : "/",
    issuedAt,
    expiresAt: issuedAt + MAGIC_LINK_MAX_AGE_MS,
  };
  return sign(payload);
}

export async function verifyMagicLinkToken(token: string): Promise<MagicLinkPayload | null> {
  const payload = await verify<MagicLinkPayload>(token);
  if (!payload || payload.type !== "magic-link") return null;
  if (Date.now() > payload.expiresAt) return null;
  return payload;
}
