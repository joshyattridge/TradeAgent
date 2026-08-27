import { describe, expect, it, vi } from "vitest";

const { mockCalculateLotSize } = vi.hoisted(() => ({
  mockCalculateLotSize: vi.fn(),
}));

vi.mock("@jsr/neabyte__forex-calculator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@jsr/neabyte__forex-calculator")>();
  return {
    ...actual,
    calculateLotSize: mockCalculateLotSize,
  };
});

import { calculatePositionSize } from "@/lib/position-size";

describe("calculatePositionSize library errors", () => {
  it("surfaces Error messages from calculateLotSize", () => {
    mockCalculateLotSize.mockImplementation(() => {
      throw new Error("Open price must be greater than 0");
    });
    expect(
      calculatePositionSize({
        symbol: "EURUSD",
        entry: 1.1,
        stop: 1.09,
        riskUsd: 100,
      }).error,
    ).toBe("Open price must be greater than 0");
  });

  it("uses a fallback message for non-Error throws", () => {
    mockCalculateLotSize.mockImplementation(() => {
      throw "boom";
    });
    expect(
      calculatePositionSize({
        symbol: "EURUSD",
        entry: 1.1,
        stop: 1.09,
        riskUsd: 100,
      }).error,
    ).toBe("Position size calculation failed.");
  });
});
