/**
 * Usage: node scripts/create-user.mjs <username> <password>
 * Creates a dashboard user in Supabase with a hashed password.
 */
import { randomBytes, pbkdf2Sync } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Load .env.local
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter(l => l && !l.startsWith("#"))
    .map(l => l.split("=").map(p => p.trim()))
    .filter(([k]) => k)
    .map(([k, ...v]) => [k, v.join("=")])
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const [,, username, password] = process.argv;
if (!username || !password) {
  console.error("Usage: node scripts/create-user.mjs <username> <password>");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex");
const password_hash = `${salt}:${hash}`;

const { error } = await supabase
  .from("dashboard_users")
  .insert({ username: username.toLowerCase().trim(), password_hash });

if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}

console.log(`User "${username}" created successfully.`);
