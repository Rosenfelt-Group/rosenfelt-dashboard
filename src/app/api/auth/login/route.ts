import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, COOKIE_NAME, Role } from "@/lib/session";

const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

interface DashboardUser {
  username: string;
  password: string;
  role: Role;
}

function getUsers(): DashboardUser[] {
  const raw = process.env.DASHBOARD_USERS;
  if (!raw) return [];
  try {
    return JSON.parse(raw) as DashboardUser[];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
  }

  const users = getUsers();
  const user = users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase().trim()
  );

  if (!user || user.password !== password) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const token = await createSessionToken(user.username.toLowerCase(), user.role);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return res;
}
