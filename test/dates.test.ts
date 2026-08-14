import { describe, it, expect } from "vitest";
import { parseFeedDate } from "@/lib/dates";

describe("parseFeedDate", () => {
  it("parses standard RFC822-ish dates", () => {
    const d = parseFeedDate("Mon, 01 Jan 2024 10:00:00 GMT");
    expect(d?.toISOString()).toBe("2024-01-01T10:00:00.000Z");
  });

  it("parses ISO8601 dates", () => {
    const d = parseFeedDate("2024-02-01T12:00:00Z");
    expect(d?.toISOString()).toBe("2024-02-01T12:00:00.000Z");
  });

  it("parses bare yyyy-mm-dd dates as UTC midnight", () => {
    const d = parseFeedDate("2024-03-05");
    expect(d?.toISOString()).toBe("2024-03-05T00:00:00.000Z");
  });

  it("returns null for garbage input instead of throwing", () => {
    expect(parseFeedDate("not-a-real-date")).toBeNull();
  });

  it("returns null for missing input", () => {
    expect(parseFeedDate(null)).toBeNull();
    expect(parseFeedDate(undefined)).toBeNull();
    expect(parseFeedDate("")).toBeNull();
  });

  it("handles named US timezones", () => {
    const d = parseFeedDate("Mon, 01 Jan 2024 10:00:00 EST");
    expect(d?.toISOString()).toBe("2024-01-01T15:00:00.000Z");
  });
});
