import fs from "node:fs";
import { ZipArchive } from "archiver";

export function createZip(entries, targetPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(targetPath, { mode: 0o600 });
    const archive = new ZipArchive({ zlib: { level: 6 } });

    output.on("close", () => resolve({ size: archive.pointer() }));
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (error) => {
      if (error.code !== "ENOENT") reject(error);
    });

    archive.pipe(output);
    for (const entry of entries) {
      archive.file(entry.path, { name: entry.name });
    }
    archive.finalize();
  });
}
