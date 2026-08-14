import { NextResponse, type NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/security/auth";

const PUBLIC_PATHS = ["/login", "/favicon.ico"];

export async function proxy(request: NextRequest) {
  // TEMPORARY DEBUG — remove after diagnosing Railway auth issue.
  console.log(
    JSON.stringify({
      debug: "proxy.envCheck",
      path: request.nextUrl.pathname,
      hasAdminPassword: !!process.env.ADMIN_PASSWORD,
      hasSessionSecret: !!process.env.SESSION_SECRET,
      sessionSecretLen: process.env.SESSION_SECRET?.length ?? 0,
      nodeEnv: process.env.NODE_ENV,
      allEnvKeysStr: Object.keys(process.env).sort().join(","),
    }),
  );
  if (!process.env.ADMIN_PASSWORD) return NextResponse.next(); // auth disabled (dev convenience)
  if (PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p))) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/_next") || request.nextUrl.pathname.startsWith("/health")) {
    return NextResponse.next();
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    return new NextResponse(
      "Server misconfigured: SESSION_SECRET must be set to a random string of at least 32 characters when ADMIN_PASSWORD is set.",
      { status: 500 },
    );
  }

  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(request, response, {
    password: secret,
    cookieName: "reader_session",
    cookieOptions: { secure: process.env.NODE_ENV === "production", httpOnly: true, sameSite: "lax" },
  });

  if (!session.authenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
