/**
 * Feed dates are frequently malformed (wrong format, missing timezone,
 * two-digit years, RFC822 variants JS doesn't parse, etc). This never
 * throws: callers get `null` for a date that can't be salvaged, and the
 * article importer treats that as "no published_at", not a fatal error.
 */
export function parseFeedDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isValid(input) ? input : null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  const direct = new Date(trimmed);
  if (isValid(direct)) return direct;

  // Common malformed-but-recoverable patterns.
  const rfc822ish = trimmed.match(
    /^\w{3},?\s+(\d{1,2})\s+(\w{3,})\s+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(.*)$/,
  );
  if (rfc822ish) {
    const [, day, monthName, yearRaw, h, m, s, tz] = rfc822ish;
    const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      let year = Number(yearRaw);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      const offset = parseTimezoneOffset(tz);
      const iso = `${year}-${pad(month + 1)}-${pad(Number(day))}T${pad(Number(h))}:${m}:${s ?? "00"}${offset}`;
      const parsed = new Date(iso);
      if (isValid(parsed)) return parsed;
    }
  }

  // Bare date, e.g. "2024-01-05"
  const bareDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (bareDate) {
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    if (isValid(parsed)) return parsed;
  }

  return null;
}

function isValid(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const NAMED_TZ_OFFSETS: Record<string, string> = {
  UT: "+00:00", GMT: "+00:00", UTC: "+00:00",
  EST: "-05:00", EDT: "-04:00",
  CST: "-06:00", CDT: "-05:00",
  MST: "-07:00", MDT: "-06:00",
  PST: "-08:00", PDT: "-07:00",
  Z: "+00:00",
};

function parseTimezoneOffset(tz: string): string {
  const trimmed = tz.trim();
  if (!trimmed) return "+00:00";
  const numeric = trimmed.match(/^([+-]\d{2}):?(\d{2})$/);
  if (numeric) return `${numeric[1]}:${numeric[2]}`;
  return NAMED_TZ_OFFSETS[trimmed.toUpperCase()] ?? "+00:00";
}

export function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}
