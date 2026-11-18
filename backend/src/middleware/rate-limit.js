import { config } from "../config/env.js";
import { AppError } from "../lib/errors.js";

/**
 * Small in-process fixed-window limiter. Cloud Run instances are ephemeral, so
 * this is a coarse abuse guard rather than a global quota. Daily job and byte
 * quotas are enforced separately in Firestore.
 */
export function createRateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  const buckets = new Map();
  let lastSweep = Date.now();

  return function rateLimiter(request, _response, next) {
    if (!config.rateLimitEnabled) {
      next();
      return;
    }

    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastSweep = now;
    }

    const identity = request.user?.uid || request.ip || "anonymous";
    const key = `${identity}:${request.method}:${request.baseUrl}`;
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      request.res?.setHeader("Retry-After", String(retryAfter));
      next(
        new AppError("RATE_LIMITED", 429, "Too many requests. Wait a moment and try again."),
      );
      return;
    }

    next();
  };
}
