import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

/** Every team needs a stable auth.users id to own its rows under RLS; an
 * anonymous Supabase session gives it one without building a login flow. */
export async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;

  const { data: signedIn, error } = await supabase.auth.signInAnonymously();
  if (error || !signedIn.session) {
    throw new Error(error?.message ?? "Could not start an anonymous session");
  }
  return signedIn.session.access_token;
}
