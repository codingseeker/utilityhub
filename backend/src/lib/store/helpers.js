export function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function normalizeJob(job) {
  if (!job) return null;
  return clone(job);
}
