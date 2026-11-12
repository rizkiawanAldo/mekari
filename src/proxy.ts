import { NextResponse } from "next/server";

/**
 * Baseline security headers applied to every response.
 * (Next.js 16: this file replaces the deprecated `middleware.ts` convention.)
 *
 * The CSP is applied in production only — the dev server relies on inline
 * scripts/eval that a strict policy would block.
 */
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
].join("; ");

export function proxy() {
    const response = NextResponse.next();
    const headers = response.headers;

    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains; preload"
    );

    if (process.env.NODE_ENV === "production") {
        headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    }

    return response;
}

export const config = {
    // Skip Next.js internal assets; apply to pages and API routes alike.
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
