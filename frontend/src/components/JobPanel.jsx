import { formatBytes, summaryEntries, timeRemaining } from "../tools.js";
import StatusBadge from "./StatusBadge.jsx";

const STEPS = ["Queued", "Processing", "Done"];

function activeIndex(status) {
  if (status === "queued") return 0;
  if (status === "processing") return 1;
  return 2;
}

export default function JobPanel({
  job,
  onDownload,
  downloading,
  onDelete,
  deleting,
  onStartOver,
  actionError,
}) {
  if (job.status === "queued" || job.status === "processing") {
    return (
      <section className="job-panel" aria-live="polite">
        <div className="job-head">
          <StatusBadge status={job.status} dot />
          <span className="mono job-id">#{job.id.slice(-8)}</span>
        </div>
        <h2 className="display job-title">
          {job.status === "queued" ? "Waiting to process." : "Copying your file."}
        </h2>
        <p className="muted">
          {job.status === "queued"
            ? "Your upload is stored and ready for the demo processor."
            : "The demo processor copies the uploaded file unchanged."}
        </p>

        <ol className="timeline" aria-label="Job progress">
          {STEPS.map((step, index) => {
            const current = activeIndex(job.status);
            return (
              <li
                key={step}
                className={index < current ? "is-done" : index === current ? "is-active" : ""}
              >
                <span className="timeline-dot" aria-hidden="true" />
                <span className="mono">{step}</span>
              </li>
            );
          })}
        </ol>

        <div className="progress-track" role="progressbar" aria-label="Processing">
          <span className={job.status === "queued" ? "progress-queued" : "progress-working"} />
        </div>

        {job.pollWarning ? <p className="inline-note">{job.pollWarning}</p> : null}
        {actionError ? <p className="form-error">{actionError.message}</p> : null}
      </section>
    );
  }

  if (job.status === "done") {
    const result = job.result || {};
    const entries = summaryEntries(result.summary);
    return (
      <section className="job-panel job-panel-done" aria-live="polite">
        <div className="job-head">
          <StatusBadge status="done" dot />
          <span className="mono job-id">#{job.id.slice(-8)}</span>
        </div>
        <p className="eyebrow">Result ready</p>
        <h2 className="display job-title">Demo copy ready.</h2>
        <div className="result-file">
          <strong>{result.fileName || "processed-file"}</strong>
          <span className="mono">
            {formatBytes(result.sizeBytes)}
            {result.pageCount ? ` · ${result.pageCount} pages` : ""}
            {timeRemaining(job.expiresAt) ? ` · ${timeRemaining(job.expiresAt)}` : ""}
          </span>
        </div>

        {entries.length > 0 ? (
          <dl className="result-summary">
            {entries.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="mono">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {Array.isArray(result.previewRows) && result.previewRows.length > 0 ? (
          <div className="table-wrap" aria-label="Table preview">
            <table className="data-table">
              <thead>
                <tr>{result.previewRows[0].map((cell, index) => <th key={index}>{cell}</th>)}</tr>
              </thead>
              <tbody>
                {result.previewRows.slice(1).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {actionError ? <p className="form-error" role="alert">{actionError.message}</p> : null}

        <div className="job-actions">
          <button type="button" className="button button-primary" onClick={onDownload} disabled={downloading}>
            {downloading ? "Opening signed link…" : "Download result ↓"}
          </button>
          <button type="button" className="button button-ghost" onClick={onStartOver} disabled={deleting}>
            Process another
          </button>
        </div>
        <button type="button" className="text-button text-button-danger" onClick={onDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Delete result now"}
        </button>
      </section>
    );
  }

  const expired = job.status === "expired";
  return (
    <section className="job-panel job-panel-error" aria-live="polite">
      <div className="job-head">
        <StatusBadge status={expired ? "expired" : "failed"} dot />
        <span className="mono job-id">#{job.id.slice(-8)}</span>
      </div>
      <p className="eyebrow">{expired ? "Result expired" : "Processing stopped"}</p>
      <h2 className="display job-title">
        {expired ? "This result has expired." : "That one did not work."}
      </h2>
      <p className="muted">
        {expired
          ? "Results are deleted after the retention window. Upload the file again for a fresh result."
          : job.error?.message || "The engine could not process this file. Try again with a different file."}
      </p>
      {job.error?.code ? <p className="error-code mono">{job.error.code}</p> : null}
      {actionError ? <p className="form-error" role="alert">{actionError.message}</p> : null}
      <div className="job-actions">
        <button type="button" className="button button-primary" onClick={onStartOver}>
          {expired ? "Start over" : "Try again"}
        </button>
        {!expired ? (
          <button type="button" className="button button-ghost" onClick={onDelete} disabled={deleting}>
            {deleting ? "Clearing…" : "Clear job"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
