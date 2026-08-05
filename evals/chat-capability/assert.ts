import type { ChatActions } from "@/lib/journal-session";
import type { ChatTurnResult } from "./runner";

export type FactCheck =
  | {
      /** Numeric ground truth that must appear near keywords in the reply. */
      type: "number";
      label: string;
      value: number;
      /** Absolute tolerance (default 0.15 for floats, 0 for integers). */
      tolerance?: number;
      /** Keywords that should appear near the number (any match). */
      near: string[];
      /** Also accept integer rounding of the value. */
      allowRoundedInt?: boolean;
    }
  | {
      /** At least one of these strings/regexes must appear in the reply. */
      type: "anyOf";
      label: string;
      patterns: Array<string | RegExp>;
    }
  | {
      /** Every pattern must appear. */
      type: "allOf";
      label: string;
      patterns: Array<string | RegExp>;
    }
  | {
      /** None of these may appear (hallucination guards). */
      type: "noneOf";
      label: string;
      patterns: Array<string | RegExp>;
    };

export type ScenarioExpectation = {
  /** Tools that must be invoked at least once this turn. */
  requireTools?: string[];
  /** Tools that must NOT be invoked. */
  forbidTools?: string[];
  /** Require at least one successful (ok !== false) call per listed tool. */
  requireToolOk?: string[];
  /** Minimum agent steps (tool loop rounds). */
  minSteps?: number;
  facts?: FactCheck[];
  /** Reply must be non-empty and longer than this (default 20). */
  minReplyLength?: number;
  /** Custom checks on the full turn result. */
  custom?: (result: ChatTurnResult) => string[];
  /** Soft mutation checks when the user asked to change data. */
  actions?: {
    mustProposeAdd?: boolean;
    mustProposeUpdateId?: string;
    mustProposeDeleteId?: string;
    mustProposeStrategyUpdate?: boolean;
    addSymbol?: string;
  };
};

export type AssertionFailure = {
  check: string;
  detail: string;
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[*$`#_>~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesPattern(text: string, pattern: string | RegExp) {
  if (typeof pattern === "string") {
    return normalize(text).includes(normalize(pattern));
  }
  return pattern.test(text);
}

/** Pull numeric tokens, including percents and +/−R style values. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  // Normalize unicode minus / en-dash / em-dash to ASCII hyphen so −4.4R parses.
  const normalized = text.replace(/[\u2212\u2013\u2014]/g, "-");
  const re = /[+-]?\$?\d+(?:[.,]\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized))) {
    const raw = m[0].replace("$", "").replace(",", ".");
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function numbersNearKeywords(reply: string, keywords: string[], window = 80): number[] {
  const text = normalize(reply);
  const found: number[] = [];
  const seen = new Set<string>();
  for (const kw of keywords.map((k) => normalize(k))) {
    // Skip tiny tokens — "r" / "%" match everywhere and explode the candidate list.
    if (kw.length < 2) continue;
    let from = 0;
    let hits = 0;
    while (from < text.length && hits < 40) {
      const idx = text.indexOf(kw, from);
      if (idx < 0) break;
      hits += 1;
      const slice = text.slice(
        Math.max(0, idx - window),
        Math.min(text.length, idx + kw.length + window),
      );
      for (const n of extractNumbers(slice)) {
        const key = String(n);
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(n);
      }
      from = idx + Math.max(kw.length, 1);
    }
  }
  // Fallback: whole reply if keywords never appear — still allow global match
  if (!found.length) found.push(...extractNumbers(text));
  return found;
}

function numberMatches(
  candidates: number[],
  value: number,
  tolerance: number,
  allowRoundedInt?: boolean,
) {
  const targets = [value];
  if (allowRoundedInt) {
    targets.push(Math.round(value));
    targets.push(Math.floor(value));
    targets.push(Math.ceil(value));
  }
  // Also accept percent-style for rates already in 0–100
  if (value > 0 && value <= 100) {
    targets.push(Number(value.toFixed(1)));
    targets.push(Number(value.toFixed(0)));
  }
  return candidates.some((c) =>
    targets.some((t) => Math.abs(c - t) <= tolerance),
  );
}

export function assertTurn(
  result: ChatTurnResult,
  expectation: ScenarioExpectation,
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  const toolNames = result.tools.map((t) => t.name);
  const reply = result.reply ?? "";

  if (result.error) {
    failures.push({ check: "stream", detail: result.error });
    return failures;
  }

  const minLen = expectation.minReplyLength ?? 20;
  if (reply.trim().length < minLen) {
    failures.push({
      check: "reply-length",
      detail: `Reply too short (${reply.trim().length} < ${minLen}): ${JSON.stringify(reply)}`,
    });
  }

  for (const name of expectation.requireTools ?? []) {
    if (!toolNames.includes(name)) {
      failures.push({
        check: "require-tool",
        detail: `Expected tool ${name}; got [${toolNames.join(", ") || "none"}]`,
      });
    }
  }

  for (const name of expectation.forbidTools ?? []) {
    if (toolNames.includes(name)) {
      failures.push({
        check: "forbid-tool",
        detail: `Tool ${name} should not have been called`,
      });
    }
  }

  for (const name of expectation.requireToolOk ?? []) {
    const ok = result.tools.some((t) => t.name === name && t.ok !== false);
    if (!ok) {
      failures.push({
        check: "tool-ok",
        detail: `Expected a successful ${name} tool result`,
      });
    }
  }

  if (typeof expectation.minSteps === "number" && result.steps < expectation.minSteps) {
    failures.push({
      check: "min-steps",
      detail: `Expected ≥ ${expectation.minSteps} steps, got ${result.steps}`,
    });
  }

  for (const fact of expectation.facts ?? []) {
    if (fact.type === "number") {
      const tol =
        fact.tolerance ??
        (Number.isInteger(fact.value) ? 0 : Math.max(0.15, Math.abs(fact.value) * 0.02));
      const candidates = numbersNearKeywords(reply, fact.near);
      if (!numberMatches(candidates, fact.value, tol, fact.allowRoundedInt)) {
        failures.push({
          check: `fact:${fact.label}`,
          detail: `Expected ~${fact.value} (±${tol}) near [${fact.near.join("|")}]; numbers seen: [${candidates.slice(0, 20).join(", ")}]`,
        });
      }
    } else if (fact.type === "anyOf") {
      const hit = fact.patterns.some((p) => matchesPattern(reply, p));
      if (!hit) {
        failures.push({
          check: `fact:${fact.label}`,
          detail: `None of the expected patterns matched. Reply: ${truncate(reply)}`,
        });
      }
    } else if (fact.type === "allOf") {
      for (const p of fact.patterns) {
        if (!matchesPattern(reply, p)) {
          failures.push({
            check: `fact:${fact.label}`,
            detail: `Missing pattern ${String(p)}. Reply: ${truncate(reply)}`,
          });
        }
      }
    } else if (fact.type === "noneOf") {
      for (const p of fact.patterns) {
        if (matchesPattern(reply, p)) {
          failures.push({
            check: `fact:${fact.label}`,
            detail: `Forbidden pattern ${String(p)} found. Reply: ${truncate(reply)}`,
          });
        }
      }
    }
  }

  if (expectation.actions) {
    failures.push(...assertActions(result.actions, expectation.actions));
  }

  if (expectation.custom) {
    for (const detail of expectation.custom(result)) {
      failures.push({ check: "custom", detail });
    }
  }

  return failures;
}

function truncate(text: string, max = 280) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function assertActions(
  actions: ChatActions,
  expected: NonNullable<ScenarioExpectation["actions"]>,
): AssertionFailure[] {
  const failures: AssertionFailure[] = [];
  const adds = [
    ...(actions.addTrades ?? []),
    ...(actions.addTrade ? [actions.addTrade] : []),
  ];
  const updates = [
    ...(actions.updateTrades ?? []),
    ...(actions.updateTrade ? [actions.updateTrade] : []),
  ];
  const deletes = actions.deleteTradeIds ?? [];

  if (expected.mustProposeAdd && !adds.length) {
    failures.push({
      check: "actions:add",
      detail: "Expected a proposed new trade (log_trade)",
    });
  }
  if (expected.addSymbol && adds.length) {
    const hit = adds.some(
      (t) => t.symbol?.toUpperCase() === expected.addSymbol!.toUpperCase(),
    );
    if (!hit) {
      failures.push({
        check: "actions:add-symbol",
        detail: `Expected add for ${expected.addSymbol}; got ${adds.map((t) => t.symbol).join(", ")}`,
      });
    }
  }
  if (expected.mustProposeUpdateId) {
    const hit = updates.some((u) => u.id === expected.mustProposeUpdateId);
    if (!hit) {
      failures.push({
        check: "actions:update",
        detail: `Expected update for id ${expected.mustProposeUpdateId}; got [${updates.map((u) => u.id).join(", ") || "none"}]`,
      });
    }
  }
  if (expected.mustProposeDeleteId) {
    if (!deletes.includes(expected.mustProposeDeleteId)) {
      failures.push({
        check: "actions:delete",
        detail: `Expected delete for id ${expected.mustProposeDeleteId}; got [${deletes.join(", ") || "none"}]`,
      });
    }
  }
  if (expected.mustProposeStrategyUpdate && !actions.updateStrategy) {
    failures.push({
      check: "actions:strategy",
      detail: "Expected a proposed strategy update",
    });
  }
  return failures;
}

/** Format failures for vitest error output. */
export function formatFailures(
  scenarioId: string,
  result: ChatTurnResult,
  failures: AssertionFailure[],
) {
  const tools = result.tools.map((t) => `${t.name}${t.ok === false ? "!" : ""}`).join(", ");
  return [
    `Scenario ${scenarioId} failed (${failures.length} check(s))`,
    `Tools: [${tools || "none"}] steps=${result.steps}`,
    `Reply: ${truncate(result.reply, 500)}`,
    ...failures.map((f) => ` - [${f.check}] ${f.detail}`),
  ].join("\n");
}
