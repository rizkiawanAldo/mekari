import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

/**
 * Guards admin-only endpoints (usage/quotas) with a shared secret token.
 *
 * Behavior:
 * - In production: requires `ADMIN_TOKEN` env var AND a matching
 *   `x-admin-token` request header, compared in constant time. Fails closed.
 * - In local development (NODE_ENV !== "production"): if `ADMIN_TOKEN` is not
 *   set, access is allowed so the playground works out of the box.
 *
 * Returns a `NextResponse` error to send, or `null` if the caller is authorized.
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
    const token = process.env.ADMIN_TOKEN;

    if (!token) {
        // Fail closed in production; allow the local playground in development.
        if (process.env.NODE_ENV === "production") {
            return NextResponse.json(
                { error: "Server misconfigured: ADMIN_TOKEN is not set." },
                { status: 503 }
            );
        }
        return null;
    }

    const provided = req.headers.get("x-admin-token");
    if (!provided) {
        return NextResponse.json(
            { error: "Missing admin token ('x-admin-token' header)." },
            { status: 401 }
        );
    }

    const expected = Buffer.from(token);
    const actual = Buffer.from(provided);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return NextResponse.json({ error: "Invalid admin token." }, { status: 401 });
    }

    return null;
}
