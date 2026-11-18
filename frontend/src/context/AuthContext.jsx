import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
} from "firebase/auth";
import { firebaseAuth, firebaseEnabled } from "../firebase.js";

const AuthContext = createContext(null);
const DEV_USER_KEY = "utilityhub.dev.user";

function authMode() {
  const configured = import.meta.env.VITE_AUTH_MODE;
  if (configured === "dev") return "dev";
  if (configured === "firebase") return firebaseEnabled ? "firebase" : "unconfigured";
  if (firebaseEnabled) return "firebase";
  return import.meta.env.DEV ? "dev" : "unconfigured";
}

function readDevUser() {
  try {
    const raw = localStorage.getItem(DEV_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function mapFirebaseUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email?.split("@")[0] || "UtilityHub user",
    photoURL: user.photoURL || null,
    dev: false,
  };
}

function friendlyAuthError(error) {
  const code = error?.code || "";
  if (code === "auth/popup-closed-by-user") return "Google sign-in was closed before it finished.";
  if (code === "auth/cancelled-popup-request") return "Another sign-in attempt is already open.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
    return "That email and password do not match an account.";
  }
  if (code === "auth/email-already-in-use") return "An account already exists for that email.";
  if (code === "auth/weak-password") return "Use a password with at least 6 characters.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (code === "auth/popup-blocked") return "Your browser blocked the sign-in popup. Allow popups and retry.";
  if (code === "auth/unauthorized-domain") {
    return "This domain is not authorized in Firebase Authentication.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Enable this sign-in provider in Firebase Authentication first.";
  }
  return error?.message || "Sign-in could not be completed.";
}

export function AuthProvider({ children }) {
  const mode = useMemo(authMode, []);
  const [user, setUser] = useState(() => (mode === "dev" ? readDevUser() : null));
  const [status, setStatus] = useState(mode === "dev" ? "ready" : "loading");
  const [error, setError] = useState(null);

  useEffect(() => {
    if (mode !== "firebase" || !firebaseAuth) {
      setStatus("ready");
      return undefined;
    }
    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (nextUser) => {
        setUser(mapFirebaseUser(nextUser));
        setStatus("ready");
      },
      (authError) => {
        setError(friendlyAuthError(authError));
        setStatus("ready");
      },
    );
    return unsubscribe;
  }, [mode]);

  const devSignIn = useCallback((name) => {
    const clean = String(name || "").trim();
    if (!clean) {
      setError("Enter a name for the local development identity.");
      return false;
    }
    const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dev";
    const nextUser = {
      uid: `dev-${slug}`.slice(0, 64),
      email: `${slug}@dev.utilityhub.local`,
      displayName: clean,
      photoURL: null,
      dev: true,
    };
    localStorage.setItem(DEV_USER_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
    setError(null);
    return true;
  }, []);

  const signInGoogle = useCallback(async () => {
    if (!firebaseAuth) return false;
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(firebaseAuth, provider);
      return true;
    } catch (authError) {
      setError(friendlyAuthError(authError));
      return false;
    }
  }, []);

  const signInEmail = useCallback(async (email, password) => {
    if (!firebaseAuth) return false;
    setError(null);
    try {
      await signInWithEmailAndPassword(firebaseAuth, email, password);
      return true;
    } catch (authError) {
      setError(friendlyAuthError(authError));
      return false;
    }
  }, []);

  const signUpEmail = useCallback(async (email, password, displayName) => {
    if (!firebaseAuth) return false;
    setError(null);
    try {
      const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
      if (displayName?.trim()) {
        await updateProfile(credential.user, { displayName: displayName.trim() });
        setUser(mapFirebaseUser(firebaseAuth.currentUser));
      }
      return true;
    } catch (authError) {
      setError(friendlyAuthError(authError));
      return false;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    if (mode === "dev") {
      localStorage.removeItem(DEV_USER_KEY);
      setUser(null);
      return;
    }
    if (firebaseAuth) await firebaseSignOut(firebaseAuth);
  }, [mode]);

  const getAuthHeaders = useCallback(async () => {
    if (!user) return {};
    if (mode === "dev") return { "X-Dev-User": user.uid };
    if (!firebaseAuth?.currentUser) return {};
    const token = await firebaseAuth.currentUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }, [mode, user]);

  const value = useMemo(
    () => ({
      mode,
      configured: mode !== "unconfigured",
      status,
      user,
      error,
      clearError: () => setError(null),
      signInGoogle,
      signInEmail,
      signUpEmail,
      devSignIn,
      signOut,
      getAuthHeaders,
    }),
    [mode, status, user, error, signInGoogle, signInEmail, signUpEmail, devSignIn, signOut, getAuthHeaders],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
