import { useAuth } from "../context/AuthContext.jsx";
import { formatBytes, formatDate } from "../tools.js";

export default function SettingsPage({ theme, onToggleTheme }) {
  const { user } = useAuth();
  const quota = {};
  const jobPercent = quota.jobsPerDay ? Math.min(100, (quota.jobsToday / quota.jobsPerDay) * 100) : 0;
  const bytePercent = quota.bytesPerDay ? Math.min(100, (quota.bytesToday / quota.bytesPerDay) * 100) : 0;

  return (
    <main className="page-shell settings-page">
      <header className="page-head">
        <p className="eyebrow">Account & environment</p>
        <h1 className="display">Settings.</h1>
      </header>

      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">Identity</p>
            <span className="mono">DEMO MODE</span>
          </div>
          <div className="profile-line">
            <span className="profile-avatar" aria-hidden="true">{(user.displayName || user.email || "U").slice(0, 1).toUpperCase()}</span>
            <div>
              <h2>{user.displayName || "UtilityHub user"}</h2>
              <p className="mono">{user.email || user.uid}</p>
            </div>
          </div>
          <dl className="fact-list">
            <div><dt>UID</dt><dd className="mono">{user.uid}</dd></div>
            <div><dt>Provider</dt><dd>Anonymous demo</dd></div>
            <div><dt>Session</dt><dd>No account required</dd></div>
          </dl>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">Daily quota</p>
            <span className="mono">UTC RESET</span>
          </div>
          <div className="quota-block">
            <div className="quota-label"><span>Cloud jobs</span><span className="mono">{quota.jobsToday ?? "—"} / {quota.jobsPerDay ?? "—"}</span></div>
            <div className="meter"><span style={{ width: `${jobPercent}%` }} /></div>
          </div>
          <div className="quota-block">
            <div className="quota-label"><span>Uploaded bytes</span><span className="mono">{formatBytes(quota.bytesToday || 0)} / {formatBytes(quota.bytesPerDay || 0)}</span></div>
            <div className="meter meter-mint"><span style={{ width: `${bytePercent}%` }} /></div>
          </div>
          <div className="quota-block">
            <div className="quota-label"><span>Active jobs</span><span className="mono">{quota.activeJobs ?? 0} / {quota.maxActiveJobs ?? "—"}</span></div>
            <div className="meter meter-ink"><span style={{ width: `${quota.maxActiveJobs ? Math.min(100, ((quota.activeJobs || 0) / quota.maxActiveJobs) * 100) : 0}%` }} /></div>
          </div>
          <p className="fine-print">
            Demo usage limits depend on the configured backend.
          </p>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">Appearance</p>
            <span className="mono">{theme.toUpperCase()}</span>
          </div>
          <h2 className="settings-title">High contrast only.</h2>
          <p className="muted">Two themes, hard borders, no gradients. Pick the one your eyes prefer.</p>
          <div className="theme-switch" role="group" aria-label="Theme">
            <button type="button" className={theme === "light" ? "is-active" : ""} onClick={() => theme !== "light" && onToggleTheme()}>
              LIGHT
            </button>
            <button type="button" className={theme === "dark" ? "is-active" : ""} onClick={() => theme !== "dark" && onToggleTheme()}>
              DARK
            </button>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-head">
            <p className="eyebrow">Data policy</p>
            <span className="mono">GCS LIFECYCLE</span>
          </div>
          <dl className="fact-list">
            <div><dt>Upload grace</dt><dd>6 hours for unused uploads</dd></div>
            <div><dt>Result retention</dt><dd>24 hours, then signed downloads stop</dd></div>
            <div><dt>Metadata purge</dt><dd>72 hours after completion</dd></div>
            <div><dt>Download link</dt><dd>5 minutes, signed, read-only</dd></div>
            <div><dt>Storage</dt><dd>Private GCS bucket, no public objects</dd></div>
          </dl>
          <p className="fine-print">Bucket lifecycle rules run independently of the app. Deleting history removes objects immediately.</p>
        </section>

        {profile ? (
          <section className="settings-card settings-card-wide">
            <div className="settings-card-head">
              <p className="eyebrow">Server snapshot</p>
              <span className="mono">{formatDate(new Date().toISOString())}</span>
            </div>
            <pre className="code-block">{JSON.stringify({
              uid: profile.uid,
              email: profile.email,
              quota: profile.quota,
            }, null, 2)}</pre>
          </section>
        ) : null}
      </div>
    </main>
  );
}
