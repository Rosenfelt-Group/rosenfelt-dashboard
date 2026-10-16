import { NextResponse } from "next/server";
import { isEmailConfigured } from "@/lib/email/gmail";

// GET — whether the app can send email, so the UI can hide Send buttons. Says nothing about the key.
export async function GET() {
  return NextResponse.json({ configured: isEmailConfigured() });
}
