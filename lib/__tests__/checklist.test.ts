import { describe, expect, it } from "vitest";
import {
  checklistDisplayRows,
  mergeTradeChecklist,
  normalizeStrategyChecklist,
  normalizeTradeChecklist,
  reorderChecklistItems,
  resolveChecklistAnswers,
} from "@/lib/checklist";

describe("checklist helpers", () => {
  it("normalizes strategy checklist and drops invalid/duplicate ids", () => {
    expect(
      normalizeStrategyChecklist([
        { id: "a", label: " Bias " },
        { id: "a", label: "dup" },
        { id: "", label: "bad" },
        { id: "b", label: "" },
        { id: 3, label: "num" },
        { id: "c", label: 4 },
        null,
        "x",
        [],
      ]),
    ).toEqual([{ id: "a", label: "Bias" }]);
    expect(normalizeStrategyChecklist(undefined)).toEqual([]);
  });

  it("normalizes trade checklist answers", () => {
    expect(normalizeTradeChecklist(undefined)).toEqual([]);
    expect(
      normalizeTradeChecklist([
        { id: "a", label: "Bias", checked: true },
        { id: "b", label: "PD", checked: false },
        { id: "c", label: "POI", checked: "yes" },
        { id: 1, label: "num", checked: true },
        { id: "d", label: 2, checked: true },
        { id: "a", label: "dup", checked: false },
        null,
        [],
      ]),
    ).toEqual([
      { id: "a", label: "Bias", checked: true },
      { id: "b", label: "PD", checked: false },
    ]);
  });

  it("resolves answers against strategy and rejects unknown ids", () => {
    const strategy = [
      { id: "cl-bias", label: "Daily bias" },
      { id: "cl-pd", label: "PD zone" },
    ];
    expect(
      resolveChecklistAnswers(strategy, [
        { id: "cl-bias", checked: true },
        { id: "cl-pd", checked: false },
      ]),
    ).toEqual({
      ok: true,
      checklist: [
        { id: "cl-bias", label: "Daily bias", checked: true },
        { id: "cl-pd", label: "PD zone", checked: false },
      ],
    });

    expect(resolveChecklistAnswers(undefined, undefined)).toEqual({
      ok: true,
      checklist: [],
    });
    expect(resolveChecklistAnswers(strategy, [])).toEqual({
      ok: true,
      checklist: [],
    });
    expect(
      resolveChecklistAnswers(undefined, [
        { id: "cl-bias", checked: true },
      ]).ok,
    ).toBe(false);

    expect(
      resolveChecklistAnswers(strategy, [
        { id: "  ", checked: true },
        { id: "cl-bias", checked: true },
        { id: "cl-bias", checked: false },
      ]),
    ).toEqual({
      ok: true,
      checklist: [
        { id: "cl-bias", label: "Daily bias", checked: true },
      ],
    });

    const bad = resolveChecklistAnswers(strategy, [
      { id: "missing", checked: true },
    ]);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.unknownIds).toEqual(["missing"]);
  });

  it("merges trade checklist answers by id", () => {
    expect(
      mergeTradeChecklist(undefined, [
        { id: "b", label: "B", checked: true },
      ]),
    ).toEqual([{ id: "b", label: "B", checked: true }]);
    expect(
      mergeTradeChecklist(
        [{ id: "a", label: "A", checked: true }],
        [{ id: "a", label: "A", checked: false }, { id: "b", label: "B", checked: true }],
      ),
    ).toEqual([
      { id: "a", label: "A", checked: false },
      { id: "b", label: "B", checked: true },
    ]);
  });

  it("builds display rows with unanswered strategy items and orphans", () => {
    expect(checklistDisplayRows(undefined, undefined)).toEqual([]);
    expect(
      checklistDisplayRows(
        [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        [
          { id: "a", label: "A old", checked: true },
          { id: "orphan", label: "Removed", checked: false },
        ],
      ),
    ).toEqual([
      { id: "a", label: "A", checked: true },
      { id: "b", label: "B", checked: null },
      { id: "orphan", label: "Removed", checked: false },
    ]);
  });

  it("reorders checklist items and ignores invalid moves", () => {
    const items = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
    ];
    expect(reorderChecklistItems(items, "b", -1).map((i) => i.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(reorderChecklistItems(items, "a", -1)).toBe(items);
    expect(reorderChecklistItems(items, "c", 1)).toBe(items);
    expect(reorderChecklistItems(items, "missing", 1)).toBe(items);
  });
});
