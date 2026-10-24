import { NextRequest } from "next/server";
import { runOnChecks } from "@/lib/checks";

// Runs on the checks service (moved from Casey, 2026-10-24).
export async function POST(req: NextRequest) {
  return runOnChecks(req, "/regression/run");
}
