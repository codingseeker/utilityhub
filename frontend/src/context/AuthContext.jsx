import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase, supabaseEnabled } from "../supabase.js";

const AuthContext = createContext(null);

function mapSupabaseUser(user) {
  if (!user) return null;
  const metadata = user.user_metadata || {};
  return {
    uid: user.id,
    email: user.email,
    displayName:
      metadata.display_name ||
      metadata.full_name ||
      metadata.name ||
      user.email?.split("@")[0] ||
      "UtilityHub user",
    photoURL: metadata.avatar_url || metadata.picture || null,
    emailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
    dev: false,
  };
}

function friendlyAuthError(error) {
  const code = error?.code || "";
  const message = error?.message || "";

  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return "That email and password do not match an account.";
  }
  if (code === "email_not_confirmed") {
    return "Confirm your email address before signing in. Check your inbox for the verification link.";
  }
  if (code === "user_already_exists" || /already registered/i.test(message)) {
    return "An account already exists for that email. Sign in instead.";
  }
  if (code === "weak_password" || /password should be/i.test(message)) {
    return "Use a stronger password (at least 6 characters).";
  }
  if (code === "invalid_email" || /invalid email/i.test(message)) {
    return "Enter a valid email address.";
  }
  if (code === "over_email_send_rate_limit" || /rate limit/i.test(message)) {
    return "Too many emails were sent. Wait a minute and try again.";
  }
  if (code === "signup_disabled") {
    return "Account signup is disabled for this project.";
  }
  return message || "Sign-in could not be completed.";
}

export function AuthProvider({ children }) {
  const mode = supabaseEnabled ? "supabase" : "unconfigured";
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!supabase) {
      setStatus("ready");
      return undefined;
    }

    let active = true;

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return;
        if (sessionError) setError(friendlyAuthError(sessionError));
        setUser(mapSupabaseUser(data?.session?.user));
        setStatus("ready");
      })
      .catch((sessionError) => {
        if (!active) return;
        setError(friendlyAuthError(sessionError));
        setStatus("ready");
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(mapSupabaseUser(session?.user));
      setStatus("ready");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const signInEmail = useCallback(async (email, password) => {
    if (!supabase) return false;
    setError(null);
    setNotice(null);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        console.error("Supabase sign-in failed:", authError);
        setError(authError.message || friendlyAuthError(authError));
        return false;
      }
      return true;
    } catch (authError) {
      console.error("Supabase sign-in failed:", authError);
      setError(authError?.message || friendlyAuthError(authError));
      return false;
    }
  }, []);

  const signUpEmail = useCallback(async (email, password, displayName) => {
    if (!supabase) return false;
    setError(null);
    setNotice(null);

    const name = displayName?.trim();

    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: name ? { display_name: name } : undefined,
        },
      });

      if (authError) {
        console.error("Supabase sign-up failed:", authError);
        setError(authError.message || friendlyAuthError(authError));
        return false;
      }

      // Projects with email confirmation enabled return a user but no session.
      if (!data.session) {
        setNotice("Account created. Check your email for a confirmation link, then sign in.");
        return false;
      }
      return true;
    } catch (authError) {
      console.error("Supabase sign-up failed:", authError);
      setError(authError?.message || friendlyAuthError(authError));
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    setNotice(null);
    if (supabase) await supabase.auth.signOut();
  }, []);

  const getAuthHeaders = useCallback(async () => {
    if (!supabase) return {};
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }, []);

  const value = useMemo(
    () => ({
      mode,
      configured: mode !== "unconfigured",
      status,
      user,
      error,
      notice,
      clearError,
      signInEmail,
      signUpEmail,
      signOut,
      getAuthHeaders,
    }),
    [
      mode,
      status,
      user,
      error,
      notice,
      clearError,
      signInEmail,
      signUpEmail,
      signOut,
      getAuthHeaders,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
