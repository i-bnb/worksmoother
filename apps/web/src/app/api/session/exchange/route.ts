import { NextRequest, NextResponse } from "next/server";

// export const runtime = "nodejs";

/**
 * POST /api/session/exchange
 *
 * Receives an Appwrite 15-minute JWT (via Authorization header or JSON body),
 * verifies it against Appwrite Project A, and issues a first-party session:
 *  - Short-lived access token in the JSON response body (stored in-memory by client)
 *  - Long-lived refresh token as an HttpOnly, SameSite=Strict cookie
 *
 * This route uses node-appwrite (server SDK) — it is safe from client-side exposure.
 */
export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json().catch(() => ({}));

    // Extract JWT from Authorization header or body
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : body.jwt || "";

    if (!jwt) {
      return NextResponse.json(
        { error: "MISSING_JWT", message: "Appwrite JWT is required in Authorization header or body.jwt" },
        { status: 400 }
      );
    }

    // ── Verify the Appwrite JWT via node-appwrite ──────────────────────────
    // Dynamic import so Zod env validation only runs server-side
    const { verifyAppwriteJwtA } = await import("../../../../lib/appwrite/server-operational");

    let verifiedUser: { userId: string; email: string; name: string };
    try {
      verifiedUser = await verifyAppwriteJwtA(jwt);
    } catch (appwriteErr: any) {
      const code = appwriteErr?.code ?? 0;
      if (code === 401 || code === 403) {
        return NextResponse.json(
          { error: "INVALID_JWT", message: "Appwrite JWT is invalid or expired." },
          { status: 401 }
        );
      }
      // Appwrite unreachable — fall back to mock in dev only
      if (process.env.NODE_ENV !== "production" && jwt.includes("mock")) {
        verifiedUser = { userId: "usr_mock_01", email: "mock@doctorcare.org", name: "Mock Staff User" };
      } else {
        throw appwriteErr;
      }
    }

    // ── Issue first-party tokens ───────────────────────────────────────────
    // In production this would be a signed JWT; here we use a structured token.
    const issuedAt = Date.now();
    const expiresIn = 900; // 15 minutes
    const accessToken = Buffer.from(
      JSON.stringify({
        sub: verifiedUser.userId,
        email: verifiedUser.email,
        name: verifiedUser.name,
        roles: ["staff"],
        iat: issuedAt,
        exp: issuedAt + expiresIn * 1000,
      })
    ).toString("base64url");

    const refreshToken = `rft_${verifiedUser.userId}_${crypto.randomUUID()}`;

    // ── Build response ─────────────────────────────────────────────────────
    const res = NextResponse.json({
      status: "SESSION_ISSUED",
      accessToken,
      expiresIn,
      user: {
        id: verifiedUser.userId,
        name: verifiedUser.name,
        email: verifiedUser.email,
        roles: ["staff"],
        mfaEnabled: false,
      },
      session: {
        sessionId: `sess_${crypto.randomUUID().slice(0, 8)}`,
        familyId: `fam_${crypto.randomUUID().slice(0, 8)}`,
        mfaVerified: false,
      },
    });

    // Set HttpOnly, SameSite=Strict refresh token cookie
    res.cookies.set("__Host-refresh_token", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return res;
  } catch (err: any) {
    console.error("[session/exchange] Error:", err);
    return NextResponse.json(
      { error: "SESSION_EXCHANGE_FAILED", message: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
