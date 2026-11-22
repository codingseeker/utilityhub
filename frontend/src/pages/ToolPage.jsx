import { useEffect, useState } from "react";
import {
  createJob,
  deleteJob,
  discardUpload,
  fetchJob,
  formatApiError,
  requestDownload,
  uploadJobFiles,
} from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import {
  buildOptions,
  defaultOptions,
  formatBytes,
  isLocalTool,
  optionValueLabel,
  optionVisible,
  validateOptions,
  TOOL_SUMMARIES,
  CATEGORY_META,
} from "../tools.js";
import FileDropzone from "../components/FileDropzone.jsx";
import FileList from "../components/FileList.jsx";
import JobPanel from "../components/JobPanel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ToolIcon from "../components/ToolIcon.jsx";
import { FileServiceRouter } from "../services/FileServiceRouter.js";
import { OFFICE_TO_PDF_MESSAGE, isOfficeFile } from "../services/fileTypes.js";
import ClientToolPage from "./ClientToolPage.jsx";
import LocalToolPage from "./LocalToolPage.jsx";

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

function maxSizeFor(tool) {
  return tool.input?.maxFileSizeBytes || 25 * 1024 * 1024;
}

function maxTotalFor(tool) {
  return tool.input?.maxTotalBytes || maxSizeFor(tool) * (tool.input?.maxFiles || 1);
}

export default function ToolPage({ tool, navigate, onSignIn }) {
  const { user, getAuthHeaders } = useAuth();
  const [files, setFiles] = useState([]);
  const [options, setOptions] = useState(() => defaultOptions(tool));
  const [job, setJob] = useState(null);
  const [upload, setUpload] = useState({ active: false, progress: 0, stage: null });
  const [formError, setFormError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Client utilities have no file input and older catalog responses omitted it.
  const input = tool.input || { kind: "none", minFiles: 0, maxFiles: 0, accept: [], extensions: [] };
  const minFiles = input.minFiles ?? 0;
  const maxFiles = input.maxFiles ?? 0;
  const maxBytes = maxSizeFor(tool);
  const maxTotal = maxTotalFor(tool);
  const isClient = tool.runtime === "client";
  const isLocal = isLocalTool(tool);

  useEffect(() => {
    setFiles([]);
    setOptions(defaultOptions(tool));
    setJob(null);
    setFormError(null);
    setActionError(null);
    setUpload({ active: false, progress: 0, stage: null });

    if (isClient) return;

    if (isLocal) return;

    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("job");
    if (!jobId || !user) return;

    let cancelled = false;
    (async () => {
      try {
        const auth = await getAuthHeaders();
        const data = await fetchJob(jobId, auth);
        if (cancelled) return;
        if (data.operation !== tool.id) {
          setFormError("That job belongs to a different tool.");
          return;
        }
        setJob(data);
      } catch (error) {
        if (!cancelled) setFormError(error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tool.id, user?.uid, isClient, isLocal, getAuthHeaders, tool]);

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "processing") || !user) {
      return undefined;
    }
    let cancelled = false;
    let timer = null;

    const poll = async () => {
      try {
        const auth = await getAuthHeaders();
        const data = await fetchJob(job.id, auth);
        if (cancelled) return;
        if (data.operation !== tool.id) {
          setJob(null);
          setFormError("That job belongs to a different tool.");
          return;
        }
        setJob({ ...data, pollWarning: null });
        if (data.status === "queued" || data.status === "processing") {
          timer = setTimeout(poll, data.pollAfterMs || 1000);
        }
      } catch (error) {
        if (cancelled) return;
        if (error.status === 404 || error.status === 410) {
          setJob(null);
          setFormError(error);
          return;
        }
        setJob((previous) => ({ ...previous, pollWarning: "Connection interrupted. Retrying…" }));
        timer = setTimeout(poll, 2500);
      }
    };

    timer = setTimeout(poll, 600);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [job?.id, job?.status, user, getAuthHeaders, tool.id]);

  if (isClient) {
    return <ClientToolPage tool={tool} navigate={navigate} />;
  }

  if (isLocal) {
    return <LocalToolPage tool={tool} navigate={navigate} />;
  }

  if (!user) {
    return (
      <main className="page-shell narrow-page">
        <button type="button" className="back-link" onClick={() => navigate("/browse")}>
          <span aria-hidden="true">←</span> All tools
        </button>
        <div className="gate-card">
          <span className="gate-mark"><ToolIcon id={tool.id} size={44} /></span>
          <StatusBadge status="cloud" label="CLOUD TOOL" />
          <p className="eyebrow">{CATEGORY_META[tool.category]?.name || tool.category}</p>
          <h1 className="display">{tool.name} needs an identity.</h1>
          <p>
            Cloud jobs are scoped to your account and uploaded straight to
            signed Cloud Storage URLs. Sign in to continue.
          </p>
          <button type="button" className="button button-mustard" onClick={onSignIn}>Sign in to run this tool</button>
        </div>
      </main>
    );
  }

  function addFiles(list) {
    setFormError(null);
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
      if (isOfficeFile(file)) {
        localError =
          tool.category === "pdf" || (tool.input?.extensions || []).includes(".pdf")
            ? OFFICE_TO_PDF_MESSAGE
            : `${file.name} is an Office file. Use a ● LOCAL Office tool so it stays in your browser.`;
        continue;
      }
      if (!isAccepted(file, tool)) {
        localError = `${file.name} is not a supported file type for this tool.`;
        continue;
      }
      if (file.size > maxBytes) {
        localError = `${file.name} is larger than ${formatBytes(maxBytes)}.`;
        continue;
      }
      accepted.push({ id: makeKey(), file });
    }

    if (localError) setFormError(localError);
    if (accepted.length === 0) return;

    const next = [...files, ...accepted];
    const total = next.reduce((sum, entry) => sum + entry.file.size, 0);
    if (total > maxTotal) {
      setFormError(`The combined files are larger than ${formatBytes(maxTotal)}.`);
      return;
    }
    setFiles(next);
  }

  function removeFile(index) {
    setFiles((previous) => previous.filter((_, position) => position !== index));
    setFormError(null);
  }

  function moveFile(index, direction) {
    setFiles((previous) => {
      const target = index + direction;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      const [entry] = next.splice(index, 1);
      next.splice(target, 0, entry);
      return next;
    });
  }

  function changeOption(name, value) {
    setOptions((previous) => {
      const next = { ...previous, [name]: value };
      if (tool.id === "images-to-pdf" && name === "pageSize" && value === "fit") next.margin = 0;
      return next;
    });
    setFormError(null);
  }

  function resetJob({ keepFiles = false, message = null } = {}) {
    setJob(null);
    setDeleting(false);
    setDownloading(false);
    setActionError(null);
    setFormError(message);
    if (!keepFiles) {
      setFiles([]);
      setOptions(defaultOptions(tool));
    }
    window.history.replaceState({}, "", `/tools/${tool.id}`);
  }

  async function submit(event) {
    event.preventDefault();
    if (upload.active) return;
    setFormError(null);
    setActionError(null);

    if (files.length < minFiles) {
      setFormError(`Add at least ${minFiles} file${minFiles === 1 ? "" : "s"} to continue.`);
      return;
    }
    if (files.length > maxFiles) {
      setFormError(`You can add up to ${maxFiles} files.`);
      return;
    }
    const optionError = validateOptions(tool, options);
    if (optionError) {
      setFormError(optionError);
      return;
    }

    const route = FileServiceRouter.route({
      operationId: tool.id,
      files: files.map((entry) => entry.file),
    });
    if (route.runtime !== "cloud") {
      setFormError(OFFICE_TO_PDF_MESSAGE);
      return;
    }

    setUpload({ active: true, progress: 0, stage: "uploading" });
    let uploadIds = [];
    try {
      const auth = await getAuthHeaders();
      uploadIds = await uploadJobFiles(
        files.map((entry) => entry.file),
        auth,
        (progress) => setUpload({ active: true, progress, stage: "uploading" }),
      );
      setUpload({ active: true, progress: 100, stage: "creating" });
      const created = await createJob(
        {
          operation: tool.id,
          uploads: uploadIds,
          options: buildOptions(tool, options),
        },
        auth,
      );
      setJob(created);
      window.history.replaceState({}, "", `/tools/${tool.id}?job=${created.id}`);
    } catch (error) {
      setFormError(error);
      if (uploadIds.length > 0) {
        const auth = await getAuthHeaders();
        for (const uploadId of uploadIds) discardUpload(uploadId, auth).catch(() => undefined);
      }
    } finally {
      setUpload({ active: false, progress: 0, stage: null });
    }
  }

  async function handleDownload() {
    if (!job) return;
    setDownloading(true);
    setActionError(null);
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
    } catch (error) {
      if (error.status === 410) {
        setJob((previous) => ({ ...previous, status: "expired", error: { code: "JOB_EXPIRED", message: error.message } }));
      } else {
        setActionError(error);
      }
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete() {
    if (!job) return;
    if (!window.confirm("Delete this result now? This cannot be undone.")) return;
    setDeleting(true);
    setActionError(null);
    try {
      const auth = await getAuthHeaders();
      await deleteJob(job.id, auth);
      resetJob();
    } catch (error) {
      setActionError(error);
    } finally {
      setDeleting(false);
    }
  }

  const visibleOptions = (tool.options || []).filter((option) => optionVisible(option, options));
  const builtOptions = buildOptions(tool, options);
  const submittedOptions = (tool.options || [])
    .filter((option) => optionVisible(option, options))
    .map((option) => [option.label, optionValueLabel(option, builtOptions[option.name])]);

  return (
    <main className="page-shell tool-page">
      <button type="button" className="back-link" onClick={() => navigate("/browse")}>
        <span aria-hidden="true">←</span> All tools
      </button>

      <header className="tool-heading">
        <span className="tool-hero-icon"><ToolIcon id={tool.id} size={36} /></span>
        <div className="tool-heading-copy">
          <div className="tool-heading-meta">
            <StatusBadge status="cloud" label="CLOUD" />
            <span className="mono">{CATEGORY_META[tool.category]?.name || tool.category}</span>
          </div>
          <h1 className="display">{tool.name}</h1>
          <p>{TOOL_SUMMARIES[tool.id] || tool.description}</p>
        </div>
      </header>

      <div className="tool-layout">
        <section className="tool-main">
          {job ? (
            <JobPanel
              job={job}
              onDownload={handleDownload}
              downloading={downloading}
              onDelete={handleDelete}
              deleting={deleting}
              onStartOver={() => resetJob({ keepFiles: job.status !== "done" })}
              actionError={actionError}
            />
          ) : (
            <form className="workflow" onSubmit={submit}>
              <section className="form-block">
                <div className="block-heading">
                  <div>
                    <span className="step-label mono">STEP 01</span>
                    <h2>Add your files</h2>
                  </div>
                  <span className="count-badge mono">{files.length} / {maxFiles}</span>
                </div>

                <FileDropzone
                  onFiles={addFiles}
                  accept={[...(tool.input.accept || []), ...(tool.input.extensions || [])].join(",")}
                  extensions={tool.input.extensions || []}
                  multiple={maxFiles > 1}
                  disabled={upload.active}
                  kind={tool.input.kind}
                  maxSizeLabel={formatBytes(maxBytes)}
                />

                <FileList files={files} onRemove={removeFile} onMove={moveFile} reorderable={maxFiles > 1} />
                {maxFiles > 1 && files.length > 1 ? <p className="hint">Use the arrows to set processing order.</p> : null}

                {formError ? (
                  <div className="form-error" role="alert">
                    <p>{formatApiError(formError)}</p>
                    {formError?.details?.length ? (
                      <ul>{formError.details.map((detail) => <li key={`${detail.field}-${detail.message}`}>{detail.message}</li>)}</ul>
                    ) : null}
                  </div>
                ) : null}
              </section>

              {visibleOptions.length > 0 ? (
                <section className="form-block">
                  <div className="block-heading">
                    <div>
                      <span className="step-label mono">STEP 02</span>
                      <h2>Choose settings</h2>
                    </div>
                  </div>
                  <div className="option-grid">
                    {visibleOptions.map((option) => {
                      const disabled = tool.id === "images-to-pdf" && option.name === "margin" && options.pageSize === "fit";
                      const inputId = `option-${option.name}`;
                      return (
                        <div className={`option-field${option.type === "boolean" ? " option-field-toggle" : ""}`} key={option.name}>
                          <label htmlFor={inputId}>{option.label}</label>
                          {option.type === "enum" ? (
                            <select id={inputId} value={options[option.name] ?? ""} onChange={(event) => changeOption(option.name, event.target.value)} disabled={disabled || upload.active}>
                              {option.choices.map((choice) => <option key={String(choice)} value={choice}>{optionValueLabel(option, choice)}</option>)}
                            </select>
                          ) : null}
                          {option.type === "integer" ? (
                            <input id={inputId} type="number" min={option.min} max={option.max} value={options[option.name] ?? ""} onChange={(event) => changeOption(option.name, event.target.value)} disabled={disabled || upload.active} />
                          ) : null}
                          {option.type === "pageRange" || option.type === "pageRangeList" ? (
                            <input id={inputId} type="text" value={options[option.name] ?? ""} placeholder={option.type === "pageRange" ? "all" : "1-3, 5"} onChange={(event) => changeOption(option.name, event.target.value)} disabled={disabled || upload.active} />
                          ) : null}
                          {option.type === "boolean" ? (
                            <button
                              type="button"
                              id={inputId}
                              role="switch"
                              aria-checked={Boolean(options[option.name])}
                              className={`toggle${options[option.name] ? " is-on" : ""}`}
                              onClick={() => changeOption(option.name, !options[option.name])}
                              disabled={upload.active}
                            >
                              <span />
                              {options[option.name] ? "ON" : "OFF"}
                            </button>
                          ) : null}
                          {option.help || disabled ? <p className="field-help">{disabled ? "Margins only apply to A4 or Letter." : option.help}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              <section className="form-block submit-block">
                <button type="submit" className="button button-primary button-wide button-large" disabled={upload.active || files.length < minFiles}>
                  {upload.active
                    ? upload.stage === "creating"
                      ? "Creating job…"
                      : `Uploading ${upload.progress}%`
                    : `Process ${files.length === 1 ? "file" : "files"} in the cloud →`}
                </button>
                {upload.active ? (
                  <div className="upload-progress" role="progressbar" aria-valuenow={upload.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
                    <span style={{ width: `${upload.progress}%` }} />
                  </div>
                ) : null}
                <p className="privacy-note mono">
                  DIRECT PUT → GCS · ID TOKEN → API · RESULT EXPIRES IN 24 HOURS
                </p>
              </section>
            </form>
          )}
        </section>

        <aside className="tool-side">
          {job ? (
            <section className="side-panel">
              <p className="eyebrow">Submitted</p>
              <h2>{files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"}` : "Restored job"}</h2>
              {files.length > 0 ? (
                <ul className="submitted-files">
                  {files.map((entry) => (
                    <li key={entry.id}>
                      <span title={entry.file.name}>{entry.file.name}</span>
                      <span className="mono">{formatBytes(entry.file.size)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {submittedOptions.length > 0 ? (
                <dl className="submitted-options">
                  {submittedOptions.map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd className="mono">{value}</dd></div>
                  ))}
                </dl>
              ) : null}
              <p className="panel-note">Job ID <span className="mono">{job.id}</span></p>
            </section>
          ) : (
            <>
              <section className="side-panel">
                <p className="eyebrow">At a glance</p>
                <h2>{tool.name}</h2>
                <dl className="facts">
                  <div><dt>Files</dt><dd>{minFiles === maxFiles ? `${minFiles} required` : `${minFiles}–${maxFiles} files`}</dd></div>
                  <div><dt>Max size</dt><dd>{formatBytes(maxBytes)} each</dd></div>
                  <div><dt>Accepted</dt><dd>{(tool.input.extensions || []).join(", ") || "—"}</dd></div>
                  <div><dt>Retention</dt><dd>24 hours</dd></div>
                </dl>
              </section>

              <section className="side-panel side-panel-accent">
                <p className="eyebrow">What happens next</p>
                <ol className="mini-steps">
                  <li>API creates upload records and signed PUT URLs.</li>
                  <li>Browser uploads bytes directly to Cloud Storage.</li>
                  <li>Firestore queues a job; a Cloud Run worker claims it.</li>
                  <li>Output is verified, then a signed GET link is issued.</li>
                </ol>
              </section>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
