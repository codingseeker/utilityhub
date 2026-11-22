const LABELS = {
  queued: "Queued",
  processing: "Processing",
  done: "Done",
  failed: "Failed",
  expired: "Expired",
  pending: "Pending",
  online: "Online",
  offline: "Offline",
  checking: "Checking",
  client: "Instant",
  local: "Local",
  cloud: "Cloud",
};

export default function StatusBadge({ status, label, dot = false, className = "" }) {
  return (
    <span className={`status-badge status-badge-${status} ${className}`.trim()}>
      {dot ? <span className="badge-dot" aria-hidden="true" /> : null}
      {label || LABELS[status] || status}
    </span>
  );
}
