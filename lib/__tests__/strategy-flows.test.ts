import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildJournalBackup,
  parseJournalBackup,
} from "@/lib/backup";
import { JournalSession } from "@/lib/journal-session";
import { seedStrategy } from "@/lib/seed-data";
import { normalizeStrategy } from "@/lib/strategy-md";
import type { Strategy, Trade } from "@/lib/types";

function sampleTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    entry: 1.1682,
    stop: 1.1658,
    target: 1.173,
    rMultiple: 1.5,
    result: "win",
    ...overrides,
  };
}

describe("strategy edit / backup / chat paths", () => {
  it("chat get_strategy returns full markdown", () => {
    const session = new JournalSession({
      trades: [sampleTrade()],
      strategy: seedStrategy,
    });
    const result = session.getStrategy("all");
    expect(result.ok).toBe(true);
    expect(result.strategy.markdown).toContain("# 1H Fair Value Gap Continuation");
    expect(result.strategy.markdown).toContain("## Rules");
    expect(result.strategy.markdown.length).toBeGreaterThan(200);
  });

  it("chat can surgically edit and append strategy markdown", () => {
    const session = new JournalSession({
      trades: [],
      strategy: seedStrategy,
    });

    const replaced = session.updateStrategy({
      replacements: [
        {
          find: "# 1H Fair Value Gap Continuation",
          replace: "# New Plan",
        },
      ],
    });
    expect(replaced.ok).toBe(true);
    expect(session.strategy.name).toBe("New Plan");
    expect(session.strategy.markdown).toContain("## Rules");

    const appended = session.updateStrategy({
      appendMarkdown: "## New rule\n\nNo revenge trades.",
    });
    expect(appended.ok).toBe(true);
    expect(session.strategy.markdown).toContain("## New rule");
    expect(session.strategy.markdown).toContain("No revenge trades");

    const actions = session.toActions();
    expect(actions.updateStrategy?.markdown).toContain("No revenge trades");
    expect(actions.updateStrategy?.name).toBe("New Plan");
  });

  it("refuses short full-replace snippets from chat", () => {
    const session = new JournalSession({
      trades: [],
      strategy: seedStrategy,
    });
    const beforeLen = session.strategy.markdown.length;
    const res = session.updateStrategy({
      markdown: "# New Plan\n\nOnly A+ setups.\n",
    });
    // Short payload is folded in (append) rather than wiping the plan
    expect(res.ok).toBe(true);
    expect(session.strategy.markdown).toContain("## Rules");
    expect(session.strategy.markdown).toContain("Only A+ setups");
    expect(session.strategy.markdown.length).toBeGreaterThan(beforeLen * 0.8);
  });

  it("store-style patch from chat applies onto current strategy", () => {
    const current = seedStrategy;
    const patch = {
      markdown: `${current.markdown}\n\n## Chat note\n\nAdded by agent.\n`,
      name: current.name,
    };
    const merged = normalizeStrategy({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    expect(merged.markdown).toContain("## Chat note");
    expect(merged.markdown).toContain("Added by agent");
    expect(merged.name).toBe(current.name);
  });

  it("backup round-trips markdown strategy including image syntax", () => {
    const strategy: Strategy = {
      name: "With Image",
      markdown:
        "# With Image\n\n![chart](data:image/jpeg;base64,QUJD)\n\nBody text.\n",
      updatedAt: "2026-07-31T12:00:00.000Z",
    };
    const backup = buildJournalBackup([sampleTrade()], strategy);
    const parsed = parseJournalBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.format).toBe(BACKUP_FORMAT);
    expect(parsed.backup.version).toBe(BACKUP_VERSION);
    expect(parsed.backup.strategy.markdown).toContain("data:image/jpeg;base64,QUJD");
    expect(parsed.backup.strategy.markdown).toContain("Body text");
  });

  it("import of legacy structured strategy becomes editable markdown", () => {
    const parsed = parseJournalBackup({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: "2026-07-01T00:00:00.000Z",
      trades: [],
      strategy: {
        name: "Old",
        version: "1",
        summary: "Summary",
        edge: "Edge text",
        approach: "Approach text",
        timeframes: [],
        rules: [{ title: "R1", body: "Do X" }],
        risk: [],
        targets: [],
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Same shape the Strategy page / chat session expect
    const session = new JournalSession({
      trades: [],
      strategy: parsed.backup.strategy,
    });
    expect(session.strategy.markdown).toContain("### R1");
    const updated = session.updateStrategy({
      appendMarkdown: "## Imported note\n\nStill editable.",
    });
    expect(updated.ok).toBe(true);
    expect(session.strategy.markdown).toContain("Still editable");
  });
});
