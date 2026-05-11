import { NextResponse } from "next/server";

export const maxDuration = 10;

const PROJECT_ID = "prj_xoZ2LCzCKZaG85J9IN6Ubgis8Iiy";
const TEAM_ID    = "team_2ry5u3AoKUukaBSe1YCG8VVB";

export async function GET() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const res = await fetch(
    `https://api.vercel.com/v6/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&limit=15`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );

  if (!res.ok) {
    return NextResponse.json({ error: `Vercel API ${res.status}` }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json(data.deployments ?? []);
}
