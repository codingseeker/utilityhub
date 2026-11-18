import { useId, useState } from "react";

const KIND_LABEL = {
  pdf: "PDFs",
  image: "images",
  csv: "CSV files",
  json: "JSON files",
  text: "text files",
};

export default function FileDropzone({ onFiles, accept, extensions = [], multiple, disabled, kind, maxSizeLabel }) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  function handleFiles(list) {
    if (disabled || !list || list.length === 0) return;
    onFiles(Array.from(list));
  }

  return (
    <div
      className={`dropzone${dragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
    >
      <input
        id={inputId}
        className="sr-only"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="dropzone-icon" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square">
          <path d="M24 32V10" />
          <path d="m14 20 10-10 10 10" />
          <path d="M8 32v6h32v-6" />
        </svg>
      </div>
      <p className="dropzone-title">
        Drop {KIND_LABEL[kind] || "files"} here
      </p>
      <p className="dropzone-help">
        or{" "}
        <label htmlFor={inputId} className="dropzone-browse">
          browse {multiple ? "files" : "a file"}
        </label>
      </p>
      <p className="dropzone-meta">
        {extensions.length > 0 ? extensions.join(" · ") : "Supported files"}
        {maxSizeLabel ? ` · max ${maxSizeLabel} each` : ""}
      </p>
    </div>
  );
}
