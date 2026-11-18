const FALLBACKS = {
  pdf: "document.pdf",
  jpg: "image.jpg",
  png: "image.png",
  webp: "image.webp",
  tiff: "image.tiff",
  txt: "text.txt",
  csv: "data.csv",
  json: "data.json",
  zip: "archive.zip",
};

export function sanitizeFileName(value, fallback = "file") {
  const base = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (!base || base === "." || base === "..") {
    return fallback;
  }
  return base;
}

export function extensionOf(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name || ""));
  return match ? match[1].toLowerCase() : "";
}

export function buildBaseName(name, fallback = "document") {
  const safe = sanitizeFileName(name, fallback);
  const withoutExtension = safe.replace(/\.[A-Za-z0-9]+$/, "");
  return withoutExtension || fallback;
}

export function storageFileName(name, fallbackExtension = "bin") {
  const safe = sanitizeFileName(name, `file.${fallbackExtension}`);
  return safe.includes(".") ? safe : `${safe}.${fallbackExtension}`;
}

export function defaultNameForExtension(extension) {
  return FALLBACKS[extension] || `file.${extension || "bin"}`;
}
