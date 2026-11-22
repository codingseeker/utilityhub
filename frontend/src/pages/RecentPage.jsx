import { useCallback, useEffect, useRef, useState } from "react";
import { clearHistory, deleteJob, formatApiError, listJobs, requestDownload } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatBytes, formatDate, timeRemaining } from "../tools.js";

export default function RecentPage({ navigate, onSignIn }) {
  const { user, getAuthHeaders } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const timerRef = useRef(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!user) return;
    if (!quiet) setLoading(true);
    try {
      const auth = await getAuthHeaders();
      const data = await listJobs(auth, 40);
      setJobs(data.jobs || []);
      setError(null);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, user]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return undefined;
    }
    load();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user, load]);

  const hasActive = jobs.some((job) => job.status === "queued" || job.status === "processing");
  useEffect(() => {
    if (!hasActive || !user) return undefined;
    const timer = setTimeout(() => load({ quiet: true }), 4000);
    return () => clearTimeout(timer);
  }, [hasActive, jobs, user, load]);

  async function download(job) {
    setBusy(job.id);
    setError(null);
    try {
      const auth = await getAuthHeaders();
      const info = await requestDownload(job.id, auth);
      const link = document.createElement("a");
      link.href = info.url;
      link.download = info.fileName || job.result?.fileName || "download";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (downloadError) {
      setError(downloadError);
      load({ quiet: true });
    } finally {
      setBusy(null);
    }
  }

  async function remove(job) {
    if (!window.confirm("Delete this job and its stored files?")) return;
    setBusy(job.id);
    setError(null);
    try {
      const auth = await getAuthHeaders();
      await deleteJob(job.id, auth);
      setJobs((previous) => previous.filter((item) => item.id !== job.id));
    } catch (deleteError) {
      setError(deleteError);
    } finally {
      setBusy(null);
    }
  }

  async function clearAll() {
    if (!window.confirm("Clear all finished jobs and stored results? Active jobs stay queued.")) return;
    setBusy("all");
    setError(null);
    try {
      const auth = await getAuthHeaders();
      const result = await clearHistory(auth);
      setJobs((previous) => previous.filter((job) => job.status === "queued" || job.status === "processing"));
      if (result.deleted === 0) setError(new Error("There were no finished jobs to clear."));
    } catch (clearError) {
      setError(clearError);
    } finally {
      setBusy(null);
    }
  }

  if (!user) {
    return (
      <main className="page-shell narrow-page">
        <div className="gate-card">
          <span className="gate-mark display">ID</span>
          <p className="eyebrow">Recent jobs</p>
          <h1 className="display">Sign in to see your history.</h1>
          <p>Your job history is scoped to your account. Nothing is shared between accounts.</p>
          <button type="button" className="button button-mustard" onClick={onSignIn}>Sign in</button>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell recent-page">
      <header className="page-head page-head-row">
        <div>
          <p className="eyebrow">Your cloud history</p>
          <h1 className="display">Recent jobs.</h1>
          <p className="page-lede">Every job below was created with your identity and expires automatically.</p>
        </div>
        <div className="head-actions">
          <button type="button" className="button button-ghost button-small" onClick={() => load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="button button-ghost button-small" onClick={clearAll} disabled={busy === "all" || jobs.length === 0}>
            {busy === "all" ? "Clearing…" : "Clear finished"}
          </button>
        </div>
      </header>

      {error ? (
        <p className="form-error" role="alert">{formatApiError(error)}</p>
      ) : null}

      {loading ? (
        <div className="skeleton-list" aria-label="Loading jobs">
          <span /><span /><span />
        </div>
      ) : jobs.length === 0 ? (
        <div className="empty-state">
          <span className="display">∅</span>
          <h2>No jobs yet.</h2>
          <p>Send a file through a cloud tool and it will show up here.</p>
          <button type="button" className="button button-mustard" onClick={() => navigate("/browse")}>Browse tools</button>
        </div>
      ) : (
        <ul className="job-list">
          {jobs.map((job) => {
            const remaining = timeRemaining(job.expiresAt);
            const active = job.status === "queued" || job.status === "processing";
            return (
              <li key={job.id} className="job-row">
                <div className="job-row-main">
                  <div className="job-row-title">
                    <StatusBadge status={job.status} dot />
                    <button type="button" className="link-button" onClick={() => navigate(`/tools/${job.operation}`)}>
                      {job.name || job.operation}
                    </button>
                  </div>
                  <p className="mono job-row-meta">
                    #{job.id.slice(-10)} · {formatDate(job.createdAt)}
                    {job.result?.fileName ? ` · ${job.result.fileName}` : ""}
                    {job.result?.sizeBytes ? ` · ${formatBytes(job.result.sizeBytes)}` : ""}
                    {job.status === "done" && remaining ? ` · ${remaining}` : ""}
                    {job.status === "failed" && job.errorCode ? ` · ${job.errorCode}` : ""}
                  </p>
                </div>
                <div className="job-row-actions">
                  {job.status === "done" ? (
                    <button type="button" className="button button-small button-primary" onClick={() => download(job)} disabled={busy === job.id}>
                      {busy === job.id ? "…" : "Download"}
                    </button>
                  ) : null}
                  {!active ? (
                    <button type="button" className="icon-button icon-button-danger" onClick={() => remove(job)} disabled={busy === job.id} aria-label={`Delete ${job.name || job.operation}`}>
                      ×
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
