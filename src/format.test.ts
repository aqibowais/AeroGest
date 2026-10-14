import { describe, expect, it } from "vitest";
import { formatTime } from "./format";

describe("formatTime", () => {
  it("formats the run clock with tenths", () => {
    expect(formatTime(0)).toBe("00:00.0");
    expect(formatTime(12.34)).toBe("00:12.3");
    expect(formatTime(75.9)).toBe("01:15.9");
    expect(formatTime(Number.NaN)).toBe("00:00.0");
  });
});
