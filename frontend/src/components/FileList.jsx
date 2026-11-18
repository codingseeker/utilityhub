import { formatBytes } from "../tools.js";

function kindLabel(file) {
  const name = file.name.toLowerCase();
  const extension = name.split(".").pop();
  const map = {
    pdf: "PDF",
    png: "PNG",
    webp: "WEBP",
    tif: "TIFF",
    tiff: "TIFF",
    jpg: "JPG",
    jpeg: "JPG",
    csv: "CSV",
    tsv: "TSV",
    json: "JSON",
    txt: "TXT",
    md: "MD",
  };
  return map[extension] || "FILE";
}

export default function FileList({ files, onRemove, onMove, reorderable }) {
  if (files.length === 0) return null;

  return (
    <ul className="file-list" aria-label="Selected files">
      {files.map((entry, index) => (
        <li className="file-row" key={entry.id}>
          <span className={`file-badge file-badge-${kindLabel(entry.file).toLowerCase()}`}>
            {kindLabel(entry.file)}
          </span>
          <span className="file-text">
            <span className="file-name" title={entry.file.name}>{entry.file.name}</span>
            <span className="file-meta mono">
              {formatBytes(entry.file.size)} · slot {String(index + 1).padStart(2, "0")}
            </span>
          </span>
          <span className="file-actions">
            {reorderable ? (
              <>
                <button type="button" className="icon-button" onClick={() => onMove(index, -1)} disabled={index === 0} aria-label={`Move ${entry.file.name} up`}>
                  ↑
                </button>
                <button type="button" className="icon-button" onClick={() => onMove(index, 1)} disabled={index === files.length - 1} aria-label={`Move ${entry.file.name} down`}>
                  ↓
                </button>
              </>
            ) : null}
            <button type="button" className="icon-button icon-button-danger" onClick={() => onRemove(index)} aria-label={`Remove ${entry.file.name}`}>
              ×
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
