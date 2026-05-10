import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-only client — uses service role key, bypasses RLS.
// Never import this in "use client" components; SUPABASE_SERVICE_ROLE_KEY
// is not a NEXT_PUBLIC_ var and is undefined in the browser bundle.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
