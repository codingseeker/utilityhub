import pino from "pino";
import { config } from "../config/env.js";

export const logger = pino({
  level: config.logLevel,
  base: { service: "utilityhub", env: config.nodeEnv },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "*.token",
      "*.idToken",
      "*.url",
      "*.key",
    ],
    censor: "[REDACTED]",
  },
});

export function createLogger(scope) {
  return logger.child({ scope });
}
