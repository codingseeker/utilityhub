import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";

export default function AuthModal({ open, onClose }) {
  const {
    mode,
    error,
    clearError,
    signInGoogle,
    signInEmail,
    signUpEmail,
    devSignIn,
  } = useAuth();
  const [tab, setTab] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    clearError();
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, clearError]);

  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      let ok = false;
      if (mode === "dev") {
        ok = devSignIn(name || "Local Developer");
      } else if (tab === "signup") {
        ok = await signUpEmail(email.trim(), password, name);
      } else {
        ok = await signInEmail(email.trim(), password);
      }
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setBusy(true);
    try {
      if (await signInGoogle()) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Account</p>
            <h2 id="auth-title">{mode === "unconfigured" ? "Connect Firebase" : "Sign in to UtilityHub"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close sign in">
            ×
          </button>
        </div>

        {mode === "unconfigured" ? (
          <div className="auth-body">
            <p className="muted">
              Firebase Authentication is not configured for this build. Set the
              <code> VITE_FIREBASE_* </code> variables and rebuild. Cloud jobs are
              intentionally unavailable until a real identity provider is wired up.
            </p>
            <pre className="code-block">VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...</pre>
          </div>
        ) : mode === "dev" ? (
          <form className="auth-body" onSubmit={submit}>
            <div className="dev-banner">
              <strong>Development identity</strong>
              <span>
                This path is only for local verification. It sends an explicit
                <code> X-Dev-User </code> header. Production builds refuse dev auth.
              </span>
            </div>
            <label className="field">
              <span>Display name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Local Developer"
                autoFocus
              />
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button type="submit" className="button button-primary button-wide" disabled={busy}>
              {busy ? "Signing in…" : "Continue locally"}
            </button>
          </form>
        ) : (
          <div className="auth-body">
            <button type="button" className="button button-google button-wide" onClick={google} disabled={busy}>
              <span className="google-g" aria-hidden="true">G</span>
              Continue with Google
            </button>

            <div className="or-divider"><span>or use email</span></div>

            <div className="auth-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "signin"}
                className={tab === "signin" ? "is-active" : ""}
                onClick={() => { setTab("signin"); clearError(); }}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "signup"}
                className={tab === "signup" ? "is-active" : ""}
                onClick={() => { setTab("signup"); clearError(); }}
              >
                Create account
              </button>
            </div>

            <form onSubmit={submit} className="auth-form">
              {tab === "signup" ? (
                <label className="field">
                  <span>Name</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
                </label>
              ) : null}
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={tab === "signup" ? "new-password" : "current-password"}
                  placeholder="At least 6 characters"
                />
              </label>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <button type="submit" className="button button-primary button-wide" disabled={busy}>
                {busy ? "Working…" : tab === "signup" ? "Create account" : "Sign in"}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
