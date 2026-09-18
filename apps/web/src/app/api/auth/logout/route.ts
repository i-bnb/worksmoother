import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const res = NextResponse.json({ status: 'LOGGED_OUT' });

    // Explicitly expire the __Host-refresh_token cookie
    res.cookies.set('__Host-refresh_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });

    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: 'LOGOUT_ERROR', message: err.message || 'Logout failed' },
      { status: 500 }
    );
  }
}
