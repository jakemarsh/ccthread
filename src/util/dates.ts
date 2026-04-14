// Parse an ISO-ish date/time string. Returns the ms timestamp, or throws
// with a clear message. Accepts: 2026-04-01, 2026-04-01T10:00, full ISO.
export function parseDateArg(flag: string, v: string | undefined, dflt: number): number {
  if (!v) return dflt;
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) {
    throw new Error(`${flag} "${v}" is not a valid date (expected ISO 8601, e.g. 2026-04-01 or 2026-04-01T10:00:00Z)`);
  }
  return t;
}
