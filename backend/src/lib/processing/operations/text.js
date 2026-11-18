import fs from "node:fs/promises";
import path from "node:path";
import { buildBaseName } from "../../util/filenames.js";

function titleCase(text) {
  return text.replace(/\p{L}[\p{L}'’]*/gu, (word) => {
    return word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();
  });
}

function sentenceCase(text) {
  const lower = text.toLocaleLowerCase();
  return lower.replace(/(^|[.!?]\s+)(\p{L})/gu, (_match, prefix, letter) => prefix + letter.toLocaleUpperCase());
}

export async function textCase({ inputs, options, workDir }) {
  const input = inputs[0];
  const text = await fs.readFile(input.filePath, "utf8");

  const transforms = {
    upper: (value) => value.toLocaleUpperCase(),
    lower: (value) => value.toLocaleLowerCase(),
    title: titleCase,
    sentence: sentenceCase,
  };

  const output = transforms[options.mode](text);
  const artifactPath = path.join(workDir, "text.txt");
  await fs.writeFile(artifactPath, output, { mode: 0o600 });

  return {
    artifactPath,
    mimeType: "text/plain",
    extension: "txt",
    fileName: `${buildBaseName(input.file.originalName, "text")}-${options.mode}.txt`,
    pageCount: null,
    summary: { mode: options.mode, characters: output.length },
  };
}

export async function textCounter({ inputs, workDir }) {
  const input = inputs[0];
  const text = await fs.readFile(input.filePath, "utf8");
  const words = text.trim() ? text.trim().split(/\s+/u).filter(Boolean).length : 0;
  const sentences = text.trim() ? (text.match(/[^.!?]+[.!?]*/gu) || []).filter((part) => part.trim()).length : 0;
  const paragraphs = text.trim() ? text.trim().split(/\n\s*\n/u).filter(Boolean).length : 0;
  const counts = {
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/gu, "").length,
    words,
    lines: text === "" ? 0 : text.split(/\r?\n/u).length,
    sentences,
    paragraphs,
  };

  const artifactPath = path.join(workDir, "counts.json");
  await fs.writeFile(artifactPath, JSON.stringify(counts, null, 2), { mode: 0o600 });

  return {
    artifactPath,
    mimeType: "application/json",
    extension: "json",
    fileName: "counts.json",
    pageCount: null,
    summary: counts,
  };
}

export async function textCleaner({ inputs, options, workDir }) {
  const input = inputs[0];
  let text = await fs.readFile(input.filePath, "utf8");
  const before = text.length;

  if (options.stripHtml) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/giu, " ")
      .replace(/<style[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " ");
  }

  let lines = text.split(/\r?\n/u);
  if (options.trimLines) lines = lines.map((line) => line.trim());
  if (options.collapseSpaces) lines = lines.map((line) => line.replace(/[ \t]+/gu, " ").trim());
  if (options.removeBlankLines) lines = lines.filter((line) => line.trim().length > 0);

  const output = lines.join("\n");
  const artifactPath = path.join(workDir, "cleaned.txt");
  await fs.writeFile(artifactPath, output, { mode: 0o600 });

  return {
    artifactPath,
    mimeType: "text/plain",
    extension: "txt",
    fileName: `${buildBaseName(input.file.originalName, "text")}-cleaned.txt`,
    pageCount: null,
    summary: {
      originalCharacters: before,
      cleanedCharacters: output.length,
      removedCharacters: Math.max(0, before - output.length),
    },
  };
}
