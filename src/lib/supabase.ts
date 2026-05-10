import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser client — uses publishable/anon key, respects RLS.
// Safe to import in "use client" components.
// For server-side API routes use @/lib/supabase-admin instead.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
