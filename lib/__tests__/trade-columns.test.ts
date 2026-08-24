import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISIBLE_TRADE_COLUMNS,
  TRADE_COLUMNS,
  migrateVisibleTradeColumns,
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

  it("keeps hidden default columns and only swaps legacy date → entryTime", () => {
    expect(migrateVisibleTradeColumns(undefined)).toEqual(
      DEFAULT_VISIBLE_TRADE_COLUMNS,
    );
    expect(migrateVisibleTradeColumns([])).toEqual(DEFAULT_VISIBLE_TRADE_COLUMNS);
    expect(migrateVisibleTradeColumns(["setup", "rMultiple"])).toEqual(
      DEFAULT_VISIBLE_TRADE_COLUMNS,
    );
    expect(migrateVisibleTradeColumns(["setup", "rMultiple", "date"])).toEqual([
      "entryTime",
    ]);
    expect(migrateVisibleTradeColumns(["date", "entryTime", "symbol"])).toEqual([
      "entryTime",
      "symbol",
    ]);
    expect(
      migrateVisibleTradeColumns(["entryTime", "symbol", "notes", "bogus"]),
    ).toEqual(["entryTime", "symbol", "notes"]);
    const withoutNotes = DEFAULT_VISIBLE_TRADE_COLUMNS.filter((id) => id !== "notes");
    expect(migrateVisibleTradeColumns(withoutNotes)).toEqual(withoutNotes);
  });
});
