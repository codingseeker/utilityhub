import { useEffect, useRef, useState } from "react";
import FileDropzone from "../components/FileDropzone.jsx";
import FileList from "../components/FileList.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ToolIcon from "../components/ToolIcon.jsx";
import { FileServiceRouter } from "../services/FileServiceRouter.js";
import { OFFICE_TO_PDF_MESSAGE, isOfficeFile } from "../services/fileTypes.js";
import {
  CATEGORY_META,
  TOOL_SUMMARIES,
  formatBytes,
  summaryEntries,
} from "../tools.js";

function makeKey() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isAccepted(file, tool) {
  const name = file.name.toLowerCase();
  const extensions = tool.input?.extensions || [];
  if (extensions.some((extension) => name.endsWith(extension.toLowerCase()))) return true;
  if (file.type && (tool.input?.accept || []).includes(file.type)) return true;
  return false;
}

function triggerBrowserDownload(result) {
  if (!result?.url) return;
  const link = document.createElement("a");
  link.href = result.url;
  link.download = result.fileName || "utilityhub-local-download";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function LocalToolPage({ tool, navigate }) {
  const [files, setFiles] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [stage, setStage] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const downloadUrlRef = useRef(null);

  const input = tool.input || {
    kind: "office",
    minFiles: 1,
    maxFiles: 1,
    maxFileSizeBytes: 25 * 1024 * 1024,
    accept: [],
    extensions: [],
  };
  const minFiles = input.minFiles ?? 1;
  const maxFiles = input.maxFiles ?? 1;
  const maxBytes = input.maxFileSizeBytes || 25 * 1024 * 1024;
  const resultEntries = result ? summaryEntries(result.summary) : [];

  useEffect(() => {
    setFiles([]);
    setProcessing(false);
    setStage(null);
    setResult(null);
    setError(null);
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = null;
    }
  }, [tool.id]);

  useEffect(
    () => () => {
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
    },
    [],
  );

  function addFiles(list) {
    setError(null);
    setResult(null);
    const accepted = [];
    let localError = null;

    for (const file of list) {
      if (files.length + accepted.length >= maxFiles) {
        localError = `You can add up to ${maxFiles} file${maxFiles === 1 ? "" : "s"}.`;
        break;
      }
      if (file.size === 0) {
        localError = `${file.name} is empty.`;
        continue;
      }
      if (!isAccepted(file, tool)) {
        localError = isOfficeFile(file)
          ? `${file.name} is an Office file, but this tool expects ${(input.extensions || []).join(" or ")}.`
          : `${file.name} is not a supported file type for this tool.`;
        continue;
      }
      if (file.size > maxBytes) {
        localError = `${file.name} is larger than ${formatBytes(maxBytes)}.`;
        continue;
      }
      accepted.push({ id: makeKey(), file });
    }

    if (localError) setError({ message: localError, code: null });
    if (accepted.length === 0) return;
    setFiles((previous) => [...previous, ...accepted]);
  }

  function removeFile(index) {
    setFiles((previous) => previous.filter((_, position) => position !== index));
    setError(null);
  }

  function reset({ keepFiles = false } = {}) {
    setResult(null);
    setError(null);
    setStage(null);
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = null;
    }
    if (!keepFiles) setFiles([]);
  }

  async function submit(event) {
    event.preventDefault();
    if (processing) return;
    setError(null);
    setResult(null);

    if (files.length < minFiles) {
      setError({ message: `Add at least ${minFiles} file${minFiles === 1 ? "" : "s"} to continue.`, code: null });
      return;
    }

    const selected = files.map((entry) => entry.file);
    const route = FileServiceRouter.route({ operationId: tool.id, files: selected });
    if (route.runtime !== "local") {
      setError({
        message: "This tool was routed to the cloud, so processing was stopped. Office files must stay local.",
        code: "LOCAL_ROUTE_REQUIRED",
      });
      return;
    }

    setProcessing(true);
    setStage("Reading the file in this tab");
    try {
      const artifact = await FileServiceRouter.processLocal({
        operationId: tool.id,
        files: selected,
        onStage: setStage,
      });
      const url = URL.createObjectURL(artifact.blob);
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = url;
      const next = { ...artifact, url };
      setResult(next);
      try {
        triggerBrowserDownload(next);
      } catch {
        // The result panel still offers a download button if the browser blocks it.
      }
    } catch (caught) {
      setError({
        message: caught?.message || "The local processor could not finish this file.",
        code: caught?.code || "LOCAL_PROCESSING_FAILED",
      });
    } finally {
      setProcessing(false);
      setStage(null);
    }
  }

  return (
    <main className="page-shell tool-page local-page">
      <button type="button" className="back-link" onClick={() => navigate("/browse")}>
        <span aria-hidden="true">←</span> All tools
      </button>

      <header className="tool-heading">
        <span className="tool-hero-icon"><ToolIcon id={tool.id} size={36} /></span>
        <div className="tool-heading-copy">
          <div className="tool-heading-meta">
            <StatusBadge status="local" label="● LOCAL" />
            <span className="mono">{CATEGORY_META[tool.category]?.name || "Office"}</span>
          </div>
          <h1 className="display">{tool.name}</h1>
          <p>{TOOL_SUMMARIES[tool.id] || tool.description} Runs in your browser.</p>
        </div>
      </header>

      <div className="tool-layout">
        <section className="tool-main">
          {processing ? (
            <section className="local-panel local-panel-working" aria-live="polite" aria-busy="true">
              <div className="local-spinner" aria-hidden="true" />
              <p className="eyebrow">Browser processing</p>
              <h2 className="display">Working in this tab.</h2>
              <p className="muted">{stage || "Reading your file…"}</p>
              <p className="mono local-proof">NO UPLOAD · NO CLOUD JOB · ZERO API CALLS</p>
            </section>
          ) : result ? (
            <section className="job-panel job-panel-done local-panel-done" aria-live="polite">
              <div className="job-head">
                <StatusBadge status="local" label="● LOCAL DONE" dot />
                <span className="mono job-id">BROWSER</span>
              </div>
              <p className="eyebrow">Result ready</p>
              <h2 className="display job-title">Built locally.</h2>
              <div className="result-file">
                <strong>{result.fileName}</strong>
                <span className="mono">{formatBytes(result.sizeBytes)} · never uploaded</span>
              </div>

              {resultEntries.length > 0 ? (
                <dl className="result-summary">
                  {resultEntries.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd className="mono">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              <div className="job-actions">
                <button type="button" className="button button-primary" onClick={() => triggerBrowserDownload(result)}>
                  Download again ↓
                </button>
                <button type="button" className="button button-ghost" onClick={() => reset({ keepFiles: true })}>
                  Process another
                </button>
              </div>
              <button type="button" className="text-button" onClick={() => reset()}>
                Start with a new file
              </button>
              <p className="privacy-note mono">BLOB → THIS TAB · NOTHING WAS UPLOADED</p>
            </section>
          ) : (
            <form className="workflow" onSubmit={submit}>
              <section className="form-block">
                <div className="block-heading">
                  <div>
                    <span className="step-label mono">STEP 01</span>
                    <h2>Add your file</h2>
                  </div>
                  <span className="count-badge mono">{files.length} / {maxFiles}</span>
                </div>

                <FileDropzone
                  onFiles={addFiles}
                  accept={[...(input.accept || []), ...(input.extensions || [])].join(",")}
                  extensions={input.extensions || []}
                  multiple={maxFiles > 1}
                  disabled={processing}
                  kind={input.kind}
                  maxSizeLabel={formatBytes(maxBytes)}
                />

                <FileList files={files} onRemove={removeFile} reorderable={false} />

                {error ? (
                  <div className="local-error" role="alert">
                    <span className="local-error-mark display" aria-hidden="true">!</span>
                    <div>
                      <p className="eyebrow">Local processing stopped</p>
                      <p>{error.message}</p>
                      {error.code ? <p className="error-code mono">{error.code}</p> : null}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="form-block submit-block">
                <button type="submit" className="button button-primary button-wide button-large" disabled={processing || files.length < minFiles}>
                  Process locally →
                </button>
                <p className="privacy-note mono">
                  FILE → THIS TAB · BLOB DOWNLOAD · ZERO NETWORK
                </p>
              </section>
            </form>
          )}
        </section>

        <aside className="tool-side">
          <section className="side-panel">
            <p className="eyebrow">At a glance</p>
            <h2>{tool.name}</h2>
            <dl className="facts">
              <div><dt>Files</dt><dd>{minFiles === maxFiles ? `${minFiles} required` : `${minFiles}–${maxFiles} files`}</dd></div>
              <div><dt>Max size</dt><dd>{formatBytes(maxBytes)}</dd></div>
              <div><dt>Accepted</dt><dd>{(input.extensions || []).join(", ") || "—"}</dd></div>
              <div><dt>Retention</dt><dd>None — stays in this tab</dd></div>
            </dl>
          </section>

          <section className="side-panel side-panel-accent">
            <p className="eyebrow">What happens next</p>
            <ol className="mini-steps">
              <li>The file is read into memory with the browser File API.</li>
              <li>mammoth, docx, JSZip, or PptxGenJS runs in this tab.</li>
              <li>A Blob is downloaded directly. No GCS, no worker, no job.</li>
            </ol>
          </section>

          <section className="side-panel local-boundary">
            <p className="eyebrow">Local boundary</p>
            <h2>No Office → PDF.</h2>
            <p>{OFFICE_TO_PDF_MESSAGE}</p>
            <p className="mono small">LOCAL RUNTIME · ZERO NETWORK</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
