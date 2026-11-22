import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
// Public anon/publishable key only. Never put a service_role key in a browser build.
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

function createSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    return createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  } catch (error) {
    console.error("UtilityHub: Supabase client could not be initialized.", error);
    return null;
  }
}

export const supabase = createSupabaseClient();
export const supabaseEnabled = Boolean(supabase);
export { supabaseUrl, supabaseAnonKey };
