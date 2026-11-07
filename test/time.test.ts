import { describe, expect, it } from "vitest";
import { formatDuration, localDate, monthRange, parseDuration, zonedToUtc } from "../src/lib/time";

const TZ = "Europe/Warsaw";

describe("zonedToUtc", () => {
  it("handles summer time (UTC+2)", () => {
    expect(new Date(zonedToUtc("2026-07-01", "10:00", TZ)).toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });
  it("handles winter time (UTC+1)", () => {
    expect(new Date(zonedToUtc("2026-01-15", "10:00", TZ)).toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });
  it("round-trips through localDate across midnight", () => {
    const ms = zonedToUtc("2026-03-01", "00:30", TZ);
    expect(new Date(ms).toISOString()).toBe("2026-02-28T23:30:00.000Z");
    expect(localDate(ms, TZ)).toBe("2026-03-01");
  });
});

describe("monthRange", () => {
  it("this month", () => expect(monthRange("2026-10-26", 0)).toEqual({ from: "2026-10-01", to: "2026-10-31" }));
  it("last month", () => expect(monthRange("2026-10-26", -1)).toEqual({ from: "2026-09-01", to: "2026-09-30" }));
  it("last month across year boundary", () => expect(monthRange("2026-01-05", -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" }));
  it("february leap year", () => expect(monthRange("2028-02-10", 0)).toEqual({ from: "2028-02-01", to: "2028-02-29" }));
});

describe("parseDuration", () => {
  it.each([
    ["1:30", 5400], ["0:45", 2700], ["1.5", 5400], ["1,5", 5400], ["2", 7200], ["2h", 7200], ["90m", 5400], ["1h 15m", 4500],
  ])("%s -> %d", (input, sec) => expect(parseDuration(input)).toBe(sec));
  it.each(["", "abc", "0", "25", "1:60", "-1"])("rejects %s", (input) => expect(parseDuration(input)).toBeNull());
});

describe("formatDuration", () => {
  it("formats h:mm", () => {
    expect(formatDuration(5400)).toBe("1:30");
    expect(formatDuration(59)).toBe("0:00");
    expect(formatDuration(36000)).toBe("10:00");
  });
});
