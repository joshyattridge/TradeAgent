import { describe, expect, it } from "vitest";
import {
  assertTurn,
  extractNumbers,
  type ScenarioExpectation,
} from "./assert";
import type { ChatTurnResult } from "./runner";
import { assertScenarioCatalog, CHAT_SCENARIOS } from "./scenarios";
import { HARD_CHAT_SCENARIOS } from "./hard-scenarios";
import { ALL_ENVIRONMENTS } from "./environments";

function turn(partial: Partial<ChatTurnResult>): ChatTurnResult {
  return {
    reply: "",
    tools: [],
    actions: {},
    steps: 0,
    agentMessages: [],
    rawEvents: [],
    ...partial,
  };
}

describe("chat capability fixtures (offline)", () => {
  it("catalog env ids all resolve", () => {
    expect(() => assertScenarioCatalog()).not.toThrow();
    expect(CHAT_SCENARIOS.length).toBeGreaterThanOrEqual(25);
    expect(HARD_CHAT_SCENARIOS.length).toBeGreaterThanOrEqual(100);
    expect(ALL_ENVIRONMENTS.length).toBe(7);
    for (const s of HARD_CHAT_SCENARIOS) {
      expect(ALL_ENVIRONMENTS.some((e) => e.id === s.envId)).toBe(true);
    }
  });

  it("extractNumbers handles percents and unicode minus", () => {
    expect(extractNumbers("win rate 70% total +9.7R pnl -$220")).toEqual([
      70, 9.7, -220,
    ]);
    expect(extractNumbers("total is −4.4R vs −3R")).toEqual([-4.4, -3]);
  });

  it("assertTurn catches missing tools and bad facts", () => {
    const expectation: ScenarioExpectation = {
      requireTools: ["get_stats"],
      facts: [
        {
          type: "number",
          label: "wins",
          value: 7,
          near: ["wins"],
        },
        {
          type: "noneOf",
          label: "no-btc",
          patterns: [/btc/i],
        },
      ],
    };
    const failures = assertTurn(
      turn({
        reply: "You have 3 wins and also traded BTC.",
        tools: [{ name: "query_trades", ok: true }],
        steps: 1,
      }),
      expectation,
    );
    expect(failures.some((f) => f.check === "require-tool")).toBe(true);
    expect(failures.some((f) => f.check === "fact:wins")).toBe(true);
    expect(failures.some((f) => f.check === "fact:no-btc")).toBe(true);
  });

  it("assertTurn accepts nearby numeric facts and action proposals", () => {
    const failures = assertTurn(
      turn({
        reply: "Closed: 10. Wins: 7. Losses: 3. Win rate 70%. Total R +9.7.",
        tools: [
          { name: "get_stats", ok: true },
          { name: "query_trades", ok: true },
        ],
        steps: 2,
        actions: {
          updateTrades: [{ id: "t11", result: "win", rMultiple: 2 }],
        },
      }),
      {
        requireTools: ["get_stats", "query_trades"],
        requireToolOk: ["get_stats"],
        facts: [
          { type: "number", label: "wins", value: 7, near: ["wins"] },
          {
            type: "number",
            label: "win-rate",
            value: 70,
            near: ["win rate", "%"],
          },
        ],
        actions: { mustProposeUpdateId: "t11" },
      },
    );
    expect(failures).toEqual([]);
  });
});
