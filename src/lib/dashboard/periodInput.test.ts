import { describe, expect, it } from "vitest";
import { periodInput } from "@/lib/dashboard/periodInput";

describe("periodInput", () => {
  it("sends no days for a preset", () => {
    expect(periodInput("1w", -2, null)).toEqual({ preset: "1w", offset: -2, start: null, end: null });
  });

  it("sends a custom range's days", () => {
    expect(periodInput("custom", 0, { start: "2026-10-01", end: "2026-10-07" })).toEqual({
      preset: "custom",
      offset: 0,
      start: "2026-10-01",
      end: "2026-10-07",
    });
  });
});
