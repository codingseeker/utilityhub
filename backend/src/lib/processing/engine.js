import { ProcessingError } from "../errors.js";
import { runCommand } from "../util/process.js";

const RETRYABLE_SPAWN_CODES = new Set(["EAGAIN", "ETXTBSY"]);

export async function runEngine(command, args, { cwd, timeoutMs, signal }) {
  let attempt = 0;
  while (true) {
    let result;
    try {
      result = await runCommand(command, args, {
        cwd,
        timeoutMs,
        maxOutputBytes: 65536,
        signal,
      });
    } catch (error) {
      if (RETRYABLE_SPAWN_CODES.has(error?.code) && attempt === 0) {
        attempt += 1;
        continue;
      }
      throw new ProcessingError("ENGINE_UNAVAILABLE", "A required processing engine is unavailable.", {
        cause: error,
      });
    }

    if (result.aborted || result.timedOut) {
      throw new ProcessingError("PROCESSING_TIMEOUT", "Processing took too long and was stopped.");
    }

    if (result.code !== 0) {
      throw new ProcessingError("PROCESSING_FAILED", "The document could not be processed.", {
        internal: `${command} exited with code ${result.code}`,
      });
    }

    return result;
  }
}
