import { describe, expect, it } from "vitest";
import {
  checklistDisplayRows,
  checklistOrderChanged,
  diffChecklist,
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

  it("diffs checklist items by id for proposal review", () => {
    expect(diffChecklist([], [])).toEqual([]);
    expect(
      diffChecklist(
        [{ id: "a", label: "Bias" }],
        [{ id: "a", label: "Bias" }, { id: "b", label: "PD" }],
      ),
    ).toEqual([
      {
        id: "a",
        status: "same",
        before: { id: "a", label: "Bias" },
        after: { id: "a", label: "Bias" },
      },
      { id: "b", status: "add", after: { id: "b", label: "PD" } },
    ]);
    expect(
      diffChecklist(
        [{ id: "a", label: "Bias" }, { id: "gone", label: "Old" }],
        [{ id: "a", label: "HTF bias" }],
      ),
    ).toEqual([
      {
        id: "a",
        status: "change",
        before: { id: "a", label: "Bias" },
        after: { id: "a", label: "HTF bias" },
      },
      { id: "gone", status: "remove", before: { id: "gone", label: "Old" } },
    ]);
    expect(
      diffChecklist(
        [{ id: "a", label: "Bias", checked: false }],
        [{ id: "a", label: "Bias", checked: true }],
      ),
    ).toEqual([
      {
        id: "a",
        status: "change",
        before: { id: "a", label: "Bias", checked: false },
        after: { id: "a", label: "Bias", checked: true },
      },
    ]);
  });

  it("detects checklist reorder without add/remove", () => {
    expect(checklistOrderChanged([], [])).toBe(false);
    expect(
      checklistOrderChanged(
        [{ id: "a" }, { id: "b" }],
        [{ id: "b" }, { id: "a" }],
      ),
    ).toBe(true);
    expect(
      checklistOrderChanged(
        [{ id: "a" }, { id: "b" }],
        [{ id: "a" }, { id: "b" }],
      ),
    ).toBe(false);
    expect(
      checklistOrderChanged([{ id: "a" }], [{ id: "a" }, { id: "b" }]),
    ).toBe(false);
    expect(
      checklistOrderChanged(
        [{ id: "a" }, { id: "b" }],
        [{ id: "a" }, { id: "c" }],
      ),
    ).toBe(false);
  });
});
