import { afterAll, describe, expect, it } from "vitest";
import { assertTurn, formatFailures } from "./assert";
import {
  appendHistory,
  resolveEvalCredentials,
  runChatTurn,
} from "./runner";
import {
  assertScenarioCatalog,
  CHAT_SCENARIOS as BASE_CHAT_SCENARIOS,
  scenarioEnvironment,
} from "./scenarios";
import { HARD_CHAT_SCENARIOS } from "./hard-scenarios";

export const CHAT_SCENARIOS = [...BASE_CHAT_SCENARIOS, ...HARD_CHAT_SCENARIOS];
export { assertScenarioCatalog, scenarioEnvironment };

/**
 * Live end-to-end chat capability suite.
 *
 * Runs every scenario through streamAgentLoop (same path as the chat UI)
 * against fixture journals, then checks tool use + reply facts vs ground truth.
 *
 *   OPENAI_API_KEY=sk-... npm run test:chat-capability
 *
 * Optional: CHAT_EVAL_MODEL / OPENAI_MODEL (default gpt-5.6-luna)
 * Optional: CHAT_EVAL_FILTER=ict-overall  (substring match on scenario id)
 */
const { apiKey, model, reasoningEffort, enabled, runRequested } =
  resolveEvalCredentials();

assertScenarioCatalog();
for (const s of HARD_CHAT_SCENARIOS) {
  scenarioEnvironment(s);
}
if (CHAT_SCENARIOS.length < 130) {
  throw new Error(`Expected base+hard catalog ≥130, got ${CHAT_SCENARIOS.length}`);
}

if (runRequested && !apiKey) {
  throw new Error(
    "RUN_CHAT_EVAL is set but OPENAI_API_KEY (or CHAT_EVAL_API_KEY) is missing.",
  );
}

const filter = process.env.CHAT_EVAL_FILTER?.trim().toLowerCase() ?? "";
const scenarios = CHAT_SCENARIOS.filter((s) =>
  filter ? s.id.toLowerCase().includes(filter) : true,
);

type ScenarioReport = {
  id: string;
  title: string;
  ok: boolean;
  tools: string[];
  failures: string[];
  ms: number;
};

const reports: ScenarioReport[] = [];

describe.skipIf(!enabled)("chat capability (live LLM)", () => {
  if (!enabled) return;

  it("credentials are present", () => {
    expect(apiKey.length).toBeGreaterThan(10);
    expect(model.length).toBeGreaterThan(0);
  });

  describe.sequential(`model=${model} reasoning=${reasoningEffort}`, () => {
    for (const scenario of scenarios) {
      it(
        `${scenario.id}: ${scenario.title}`,
        async () => {
          const env = scenarioEnvironment(scenario);
          const started = Date.now();
          const turn = await runChatTurn({
            apiKey,
            model,
            reasoningEffort,
            strategy: env.strategy,
            trades: env.trades,
            message: scenario.message,
            referencedTradeId: scenario.referencedTradeId,
            referencedTradeIds: scenario.referencedTradeIds,
          });

          const failures = assertTurn(turn, scenario.expect).map(
            (f) => `[${f.check}] ${f.detail}`,
          );

          let followTools: string[] = [];
          if (scenario.followUp && scenario.expectFollowUp) {
            const history = appendHistory([], scenario.message, turn);
            const follow = await runChatTurn({
              apiKey,
              model,
              reasoningEffort,
              strategy: env.strategy,
              trades: env.trades,
              message: scenario.followUp,
              history,
            });
            followTools = follow.tools.map((t) => t.name);
            const followFails = assertTurn(follow, scenario.expectFollowUp);
            if (followFails.length) {
              failures.push(
                formatFailures(`${scenario.id}/follow-up`, follow, followFails),
              );
            }
          }

          const ms = Date.now() - started;
          reports.push({
            id: scenario.id,
            title: scenario.title,
            ok: failures.length === 0,
            tools: [
              ...turn.tools.map((t) => t.name),
              ...followTools.map((t) => `follow:${t}`),
            ],
            failures,
            ms,
          });

          if (failures.length) {
            expect.fail(
              formatFailures(
                scenario.id,
                turn,
                failures.map((detail) => ({ check: "agg", detail })),
              ),
            );
          }
        },
        240_000,
      );
    }
  });
});

describe.skipIf(enabled)("chat capability (skipped without key)", () => {
  it("documents how to run the live suite", () => {
    expect(
      "Set OPENAI_API_KEY and run: npm run test:chat-capability",
    ).toBeTruthy();
  });
});

afterAll(() => {
  if (!reports.length) return;
  const passed = reports.filter((r) => r.ok).length;
  const failed = reports.length - passed;
  const lines = [
    "",
    "═══ Chat capability summary ═══",
    `Model: ${model}`,
    `Reasoning: ${reasoningEffort}`,
    `Passed: ${passed}/${reports.length}${failed ? ` (failed ${failed})` : ""}`,
    ...reports.map((r) => {
      const mark = r.ok ? "✓" : "✗";
      const tools = r.tools.length ? r.tools.join(",") : "—";
      return `${mark} ${r.id} (${r.ms}ms) tools=[${tools}]`;
    }),
    "════════════════════════════════",
    "",
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
});
