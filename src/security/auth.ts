import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { timingSafeEqual, createHash } from "node:crypto";

export interface SessionData {
  authenticated?: boolean;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to a random string of at least 32 characters. Generate one with: openssl rand -base64 32",
    );
  }
  return secret;
}

function sessionOptions(): SessionOptions {
  return {
    password: sessionSecret(),
    cookieName: "reader_session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
    },
  };
}

/** Auth is entirely disabled (open access) when ADMIN_PASSWORD isn't set —
 * a deliberate convenience for local development. Production self-hosting
 * must set both ADMIN_PASSWORD and SESSION_SECRET (enforced in README). */
export function isAuthEnabled(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

export async function isAuthenticated(): Promise<boolean> {
  if (!isAuthEnabled()) return true;
  const session = await getSession();
  return session.authenticated === true;
}

export async function verifyPassword(candidate: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return true;
  // Fixed-length digest + timingSafeEqual avoids both a variable-time `===`
  // comparison and the length-mismatch throw that timingSafeEqual raises
  // when given differently-sized buffers directly.
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function login() {
  const session = await getSession();
  session.authenticated = true;
  await session.save();
}

export async function logout() {
  const session = await getSession();
  session.destroy();
}
