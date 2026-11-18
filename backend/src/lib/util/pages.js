import { AppError } from "../errors.js";

function invalidRange(pageCount) {
  return new AppError(
    "INVALID_PAGE_RANGE",
    422,
    `Enter page numbers within 1 to ${pageCount}.`,
  );
}

function parseItem(item, pageCount) {
  if (typeof item !== "string") {
    throw invalidRange(pageCount);
  }
  const value = item.trim();
  const match = /^(\d+)(?:-(\d+))?$/.exec(value);
  if (!match) {
    throw invalidRange(pageCount);
  }
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < 1 ||
    start > end ||
    end > pageCount
  ) {
    throw invalidRange(pageCount);
  }
  const pages = [];
  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }
  return pages;
}

export function parsePageRange(value, pageCount, maxItems = 200) {
  if (value === undefined || value === null || value === "all") {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  if (typeof value !== "string" || !value.trim()) {
    throw invalidRange(pageCount);
  }
  const selected = [];
  for (const item of value.split(",")) {
    selected.push(...parseItem(item, pageCount));
  }
  const unique = [...new Set(selected)];
  if (unique.length === 0 || unique.length > maxItems) {
    throw invalidRange(pageCount);
  }
  return unique;
}

export function parseSplitRanges(items, pageCount, maxParts) {
  if (!Array.isArray(items) || items.length === 0) {
    throw invalidRange(pageCount);
  }
  if (items.length > maxParts) {
    throw new AppError("INVALID_OPTIONS", 422, `You can create at most ${maxParts} parts.`);
  }
  return items.map((item) => {
    if (typeof item !== "string" || item.includes(",")) {
      throw invalidRange(pageCount);
    }
    return parseItem(item, pageCount);
  });
}

export function chunkPages(pageCount, pagesPerFile) {
  const chunks = [];
  for (let start = 1; start <= pageCount; start += pagesPerFile) {
    const end = Math.min(pageCount, start + pagesPerFile - 1);
    chunks.push(Array.from({ length: end - start + 1 }, (_, index) => start + index));
  }
  return chunks;
}
