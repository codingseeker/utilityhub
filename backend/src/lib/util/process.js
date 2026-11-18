import { spawn } from "node:child_process";

const MAX_OUTPUT_BYTES = 1024 * 1024;

export function runCommand(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    timeoutMs = 60000,
    maxOutputBytes = 65536,
    signal,
    env,
  } = options;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
          HOME: process.env.HOME || "/tmp",
          LANG: "C.UTF-8",
          TZ: "UTC",
          ...env,
        },
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onAbort = () => {
      aborted = true;
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };

    child.stdout.on("data", (chunk) => {
      if (stdoutBytes < maxOutputBytes) {
        const remaining = maxOutputBytes - stdoutBytes;
        stdout.push(chunk.subarray(0, remaining));
        stdoutBytes += Math.min(chunk.length, remaining);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderrBytes < maxOutputBytes) {
        const remaining = maxOutputBytes - stderrBytes;
        stderr.push(chunk.subarray(0, remaining));
        stderrBytes += Math.min(chunk.length, remaining);
      }
    });

    child.on("error", (error) => finish(reject, error));
    child.on("close", (code, signalName) => {
      finish(resolve, {
        code: code ?? -1,
        signal: signalName,
        timedOut,
        aborted,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export const commandLimits = Object.freeze({ MAX_OUTPUT_BYTES });
