import { useEffect, useState } from "react";

import { isAdminUser, supabase } from "./supabaseClient";

export function useAdminAuth(): { isAdmin: boolean; email: string | null; loading: boolean } {
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAdmin(isAdminUser(data.session?.user));
      setEmail(data.session?.user?.email ?? null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAdmin(isAdminUser(session?.user));
      setEmail(session?.user?.email ?? null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return { isAdmin, email, loading };
}
