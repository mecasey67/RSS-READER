import { formatDistanceToNowStrict, format, isToday, isYesterday } from "date-fns";

/** Relative time for list rows ("24 min ago", "Yesterday", "Jan 5"). Dates
 * are stored in UTC and rendered in the browser's local time zone. */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = Date.now();
  const diffMs = now - date.getTime();
  if (diffMs < 60 * 60 * 1000) return `${formatDistanceToNowStrict(date)} ago`;
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  if (diffMs < 6 * 24 * 60 * 60 * 1000) return format(date, "EEEE");
  return format(date, "MMM d");
}

export function formatFullDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return format(date, "MMMM d, yyyy 'at' h:mm a");
}
