/**
 * Office formats that must never leave the browser.
 *
 * This module is intentionally dependency-free so both the API client and the
 * local processing layer can use the same guard without creating an import
 * cycle or pulling a heavy library into the main bundle.
 */

export const OFFICE_EXTENSIONS = Object.freeze([".docx", ".pptx"]);

export const OFFICE_MIME_TYPES = Object.freeze([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export const OFFICE_TO_PDF_MESSAGE =
  "Direct PDF conversion for Office files is not supported locally. Please use the extract text tools.";

export function fileExtension(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name || ""));
  return match ? `.${match[1].toLowerCase()}` : "";
}

export function officeKind(file) {
  const extension = fileExtension(file?.name);
  if (extension === ".docx") return "docx";
  if (extension === ".pptx") return "pptx";
  return null;
}

export function isOfficeFile(file) {
  if (!file) return false;
  if (officeKind(file)) return true;
  const type = String(file.type || "").toLowerCase();
  return OFFICE_MIME_TYPES.includes(type);
}

export function isOfficeName(name) {
  return OFFICE_EXTENSIONS.includes(fileExtension(name));
}
