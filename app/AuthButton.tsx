"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { createClient } from "../lib/supabase/client";

type Props = {
  onUserChange?: (user: User | null) => void;
};

export function AuthButton({ onUserChange }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const configured = isSupabaseConfigured();
  const onUserChangeRef = useRef(onUserChange);
  onUserChangeRef.current = onUserChange;

  useEffect(() => {
    if (!configured) {
      onUserChangeRef.current?.(null);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUser(data.user);
      onUserChangeRef.current?.(data.user);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user ?? null;
      setUser(next);
      onUserChangeRef.current?.(next);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [configured]);

  const signIn = useCallback(async () => {
    if (!configured) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback`;
      await supabase.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo },
      });
    } finally {
      setBusy(false);
    }
  }, [configured]);

  const signOut = useCallback(async () => {
    if (!configured) return;
    setBusy(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      setBusy(false);
    }
  }, [configured]);

  if (!configured) return null;

  const label = user?.user_metadata?.user_name || user?.email || "Signed in";

  return (
    <div className="auth-row">
      {user ? (
        <>
          <span className="auth-user" title={user.email || undefined}>
            {String(label).slice(0, 24)}
          </span>
          <button
            type="button"
            className="chip history-action"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </>
      ) : (
        <button
          type="button"
          className="chip history-action"
          disabled={busy}
          onClick={() => void signIn()}
        >
          {busy ? "…" : "Sign in with GitHub"}
        </button>
      )}
    </div>
  );
}
