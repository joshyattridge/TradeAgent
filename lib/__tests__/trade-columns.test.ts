import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISIBLE_TRADE_COLUMNS,
  TRADE_COLUMNS,
} from "@/lib/trade-columns";

describe("trade-columns", () => {
  it("lists columns and default visibility", () => {
    expect(TRADE_COLUMNS.length).toBeGreaterThan(0);
    expect(DEFAULT_VISIBLE_TRADE_COLUMNS.length).toBeGreaterThan(0);
    for (const id of DEFAULT_VISIBLE_TRADE_COLUMNS) {
      expect(TRADE_COLUMNS.some((c) => c.id === id && c.defaultVisible)).toBe(
        true,
      );
    }
    expect(TRADE_COLUMNS.filter((c) => !c.defaultVisible).length).toBeGreaterThan(
      0,
    );
  });
});
