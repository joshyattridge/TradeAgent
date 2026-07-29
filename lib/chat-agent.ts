import OpenAI from "openai";
import { buildChartFromRequest, computeStats } from "@/lib/stats";
import type { ChartRequest, ChartSpec, Strategy, Trade } from "@/lib/types";

export const MAX_AGENT_ROUNDS = 6;

export type ChatActions = {
  addTrades?: Trade[];
  updateTrades?: Array<{ id: string } & Partial<Omit<Trade, "id">>>;
  deleteTradeIds?: string[];
  updateStrategy?: Partial<Strategy>;
  chartRequests?: ChartRequest[];
  /** Pre-built charts from the agent loop (preferred over re-building client-side) */
  charts?: ChartSpec[];
  /** Singular aliases for the last add/update (compat) */
  addTrade?: Trade;
  updateTrade?: { id: string } & Partial<Omit<Trade, "id">>;
};

export type AgentLoopResult = {
  reply: string;
  actions: ChatActions;
  activeTradeId: string | null;
  rounds: number;
};

type ToolResult = {
  content: string;
  ok: boolean;
};

const METRIC_FIELDS = [
  "entry",
  "stop",
  "target",
  "exit",
  "slPips",
  "tpPips",
  "stopDistance",
  "targetDistance",
  "timeInTradeMinutes",
  "pnlUsd",
  "riskUsd",
  "feesUsd",
  "rMultiple",
] as const;

const LABEL_FIELDS = [
  "symbol",
  "date",
  "setup",
  "session",
  "side",
  "result",
] as const;

const tradeFields = {
  date: { type: "string", description: "YYYY-MM-DD" },
  symbol: { type: "string" },
  side: { type: "string", enum: ["long", "short"] },
  setup: { type: "string" },
  entry: { type: "number" },
  stop: {
    type: "number",
    description: "Stop loss price level (SL)",
  },
  target: {
    type: "number",
    description: "Take profit price level (TP)",
  },
  exit: { type: "number" },
  slPips: {
    type: "number",
    description: "Distance from entry to SL in pips (or points for indices)",
  },
  tpPips: {
    type: "number",
    description: "Distance from entry to TP in pips (or points for indices)",
  },
  entryTime: {
    type: "string",
    description: "ISO datetime when entry filled, e.g. 2026-07-28T08:42:00Z",
  },
  exitTime: {
    type: "string",
    description: "ISO datetime when trade closed",
  },
  timeInTradeMinutes: {
    type: "number",
    description: "Minutes held; derive from entry/exit times when possible",
  },
  pnlUsd: {
    type: "number",
    description: "Realized dollar P&L (negative for losses)",
  },
  riskUsd: {
    type: "number",
    description: "Dollars risked for 1R on this trade",
  },
  size: {
    type: "string",
    description: 'Position size, e.g. "0.40 lots" or "2 contracts"',
  },
  feesUsd: { type: "number", description: "Fees/commission/swap in $" },
  rMultiple: { type: "number" },
  result: {
    type: "string",
    enum: ["win", "loss", "breakeven", "open"],
  },
  notes: { type: "string" },
  session: { type: "string" },
} as const;

export const chatTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_trade",
      description:
        "Create a NEW trade in the log. Returns the new trade id — use that id for any follow-up update_trade calls. Only call when the user clearly wants to log/save a trade (or confirms after you proposed logging). Screenshots on the message are attached automatically. Do not call this just to analyze a chart.",
      parameters: {
        type: "object",
        properties: tradeFields,
        required: [
          "date",
          "symbol",
          "side",
          "setup",
          "entry",
          "stop",
          "target",
          "rMultiple",
          "result",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_trade",
      description:
        "Modify an existing logged trade by id. Use for follow-ups about the SAME trade (result, P&L, exit, times, notes, close the trade, etc.). Prefer this over add_trade whenever an active/recent trade exists. Use the id returned from add_trade or from the trade log.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Trade id from the trade log (required)",
          },
          ...tradeFields,
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_trade",
      description:
        "Permanently delete one or more trades by id. Use to remove duplicates after reconciling, or when the user asks to delete a trade.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Single trade id to delete",
          },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Multiple trade ids to delete in one call",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_strategy",
      description: "Update fields on the user's trading strategy",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          version: { type: "string" },
          summary: { type: "string" },
          edge: { type: "string" },
          approach: { type: "string" },
          addRule: {
            type: "object",
            properties: {
              title: { type: "string" },
              body: { type: "string" },
            },
          },
          addRisk: {
            type: "object",
            properties: {
              title: { type: "string" },
              body: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_charts",
      description:
        "Generate one or more charts from the live trade log (including trades added earlier in this turn). Use presets for common views, or bar/scatter/line with field mappings for true on-the-fly analysis. Prefer field mappings over inventing data points.",
      parameters: {
        type: "object",
        properties: {
          charts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "equity",
                    "rByDay",
                    "winLoss",
                    "bySymbol",
                    "bySetup",
                    "bar",
                    "scatter",
                    "line",
                  ],
                  description:
                    "Presets: equity, rByDay, winLoss, bySymbol, bySetup. Custom: scatter (trade points), bar (grouped/bucketed), line (series).",
                },
                title: { type: "string" },
                description: { type: "string" },
                xLabel: { type: "string" },
                yLabel: { type: "string" },
                xField: {
                  type: "string",
                  enum: [...METRIC_FIELDS],
                  description: "Scatter X metric",
                },
                yField: {
                  type: "string",
                  enum: [...METRIC_FIELDS],
                  description: "Scatter Y metric",
                },
                valueField: {
                  type: "string",
                  enum: [...METRIC_FIELDS],
                  description: "Bar/line value metric (default rMultiple)",
                },
                labelField: {
                  type: "string",
                  enum: [...LABEL_FIELDS],
                  description: "Bar/line group-by or scatter point label",
                },
                aggregate: {
                  type: "string",
                  enum: ["sum", "avg", "count", "winRate"],
                  description:
                    "How to reduce trades in a bar/line group. Use winRate for hit-rate charts.",
                },
                bucketField: {
                  type: "string",
                  enum: [...METRIC_FIELDS],
                  description:
                    "Numeric field to bin for distribution charts (e.g. slPips for SL size vs win rate)",
                },
                bucketSize: {
                  type: "number",
                  description: "Bin width when bucketField is set (e.g. 10)",
                },
                closedOnly: {
                  type: "boolean",
                  description: "Default true — only closed trades",
                },
                data: {
                  type: "array",
                  description:
                    "Optional explicit points only when field mapping cannot express the chart. Prefer xField/yField/valueField/bucketField instead.",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      value: { type: "number" },
                      secondary: { type: "number" },
                      x: { type: "number" },
                      y: { type: "number" },
                    },
                    required: ["label", "value"],
                  },
                },
              },
              required: ["type"],
            },
          },
        },
        required: ["charts"],
      },
    },
  },
];

function uid() {
  return crypto.randomUUID();
}

function looksLikeFollowUpUpdate(message: string) {
  return /(update|lost|loss|won|win|closed|close it|fix|change|correct|actually|reflect|make it|set (it|the)|pnl|p&l|-\s*\$?\d|result|duplicate|remove|delete|keep the)/i.test(
    message,
  );
}

function isWeakReply(reply?: string | null) {
  if (!reply?.trim()) return true;
  const weak = [
    /^trade logged\.?$/i,
    /^trade updated\.?$/i,
    /^strategy updated\.?$/i,
    /^charts ready\.?$/i,
    /^on it\.?$/i,
    /^done\.?$/i,
    /^logged\.?$/i,
  ];
  return weak.some((re) => re.test(reply.trim()));
}

function parseToolArgs(raw: string | undefined): {
  ok: true;
  args: Record<string, unknown>;
} | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Tool arguments must be a JSON object" };
    }
    return { ok: true, args: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Invalid JSON in tool arguments" };
  }
}

function stripScreenshots(trade: Trade): Trade {
  const next = { ...trade };
  delete next.screenshots;
  return next;
}

function tradeSnapshot(trade: Trade) {
  return {
    id: trade.id,
    date: trade.date,
    symbol: trade.symbol,
    side: trade.side,
    setup: trade.setup,
    entry: trade.entry,
    stop: trade.stop,
    target: trade.target,
    exit: trade.exit,
    slPips: trade.slPips,
    tpPips: trade.tpPips,
    entryTime: trade.entryTime,
    exitTime: trade.exitTime,
    timeInTradeMinutes: trade.timeInTradeMinutes,
    pnlUsd: trade.pnlUsd,
    riskUsd: trade.riskUsd,
    size: trade.size,
    feesUsd: trade.feesUsd,
    rMultiple: trade.rMultiple,
    result: trade.result,
    session: trade.session,
    notes: trade.notes,
    hasScreenshots: Boolean(trade.screenshots?.length),
  };
}

function chartSummary(chart: ChartSpec) {
  const points = chart.data?.length ?? 0;
  const sample = (chart.data ?? []).slice(0, 5);
  return {
    id: chart.id,
    title: chart.title,
    type: chart.type,
    description: chart.description,
    pointCount: points,
    samplePoints: sample,
  };
}

/** Mutable journal used while the model calls tools within one request. */
export class JournalSession {
  trades: Trade[];
  strategy: Strategy;
  activeTradeId: string | null;
  private readonly userMessage: string;
  private readonly turnHasScreenshots: boolean;
  private readonly addTrades: Trade[] = [];
  private readonly updateTrades: Array<
    { id: string } & Partial<Omit<Trade, "id">>
  > = [];
  private readonly deleteTradeIds = new Set<string>();
  private updateStrategyPatch: Partial<Strategy> | undefined;
  private readonly chartRequests: ChartRequest[] = [];
  private readonly charts: ChartSpec[] = [];

  constructor(opts: {
    trades: Trade[];
    strategy: Strategy;
    activeTradeId?: string | null;
    userMessage: string;
    turnHasScreenshots?: boolean;
  }) {
    this.trades = opts.trades.map((t) => ({ ...t }));
    this.strategy = { ...opts.strategy };
    this.activeTradeId = opts.activeTradeId ?? null;
    this.userMessage = opts.userMessage;
    this.turnHasScreenshots = Boolean(opts.turnHasScreenshots);
  }

  getStats() {
    return computeStats(this.trades);
  }

  toActions(): ChatActions {
    const addTrades = this.addTrades.map(stripScreenshots);
    const updateTrades = [...this.updateTrades];
    const deleteTradeIds = [...this.deleteTradeIds];
    const actions: ChatActions = {};

    if (addTrades.length) {
      actions.addTrades = addTrades;
      actions.addTrade = addTrades[addTrades.length - 1];
    }
    if (updateTrades.length) {
      actions.updateTrades = updateTrades;
      actions.updateTrade = updateTrades[updateTrades.length - 1];
    }
    if (deleteTradeIds.length) {
      actions.deleteTradeIds = deleteTradeIds;
    }
    if (this.updateStrategyPatch) {
      actions.updateStrategy = this.updateStrategyPatch;
    }
    if (this.chartRequests.length) {
      actions.chartRequests = this.chartRequests;
    }
    if (this.charts.length) {
      actions.charts = this.charts;
    }
    return actions;
  }

  execute(name: string, rawArgs: string | undefined): ToolResult {
    const parsed = parseToolArgs(rawArgs);
    if (!parsed.ok) {
      return {
        ok: false,
        content: JSON.stringify({ ok: false, error: parsed.error }),
      };
    }

    try {
      switch (name) {
        case "add_trade":
          return this.addTrade(parsed.args);
        case "update_trade":
          return this.updateTrade(parsed.args);
        case "delete_trade":
          return this.deleteTrade(parsed.args);
        case "update_strategy":
          return this.updateStrategy(parsed.args);
        case "generate_charts":
          return this.generateCharts(parsed.args);
        default:
          return {
            ok: false,
            content: JSON.stringify({
              ok: false,
              error: `Unknown tool: ${name}`,
            }),
          };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tool execution failed";
      return {
        ok: false,
        content: JSON.stringify({ ok: false, error: message }),
      };
    }
  }

  private addTrade(args: Record<string, unknown>): ToolResult {
    // Follow-up details about the active trade should update, not duplicate
    if (
      this.activeTradeId &&
      looksLikeFollowUpUpdate(this.userMessage) &&
      this.trades.some((t) => t.id === this.activeTradeId)
    ) {
      return this.updateTrade({ ...args, id: this.activeTradeId });
    }

    const trade = normalizeNewTrade(args, this.turnHasScreenshots);
    if ("error" in trade) {
      return {
        ok: false,
        content: JSON.stringify({ ok: false, error: trade.error }),
      };
    }

    this.trades = [trade, ...this.trades];
    this.activeTradeId = trade.id;
    this.addTrades.push(trade);

    return {
      ok: true,
      content: JSON.stringify({
        ok: true,
        action: "add_trade",
        trade: tradeSnapshot(trade),
        activeTradeId: this.activeTradeId,
        stats: this.getStats(),
        note: "Use this trade.id for any further updates to this trade. Do not call add_trade again for the same position.",
      }),
    };
  }

  private updateTrade(args: Record<string, unknown>): ToolResult {
    const id = typeof args.id === "string" ? args.id : "";
    if (!id) {
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          error: "update_trade requires id",
        }),
      };
    }

    const existing = this.trades.find((t) => t.id === id);
    if (!existing) {
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          error: `No trade found with id ${id}`,
          activeTradeId: this.activeTradeId,
          hint: "Use an id from the trade log or from a prior add_trade result.",
        }),
      };
    }

    const patch = tradePatchFromArgs(args);
    const next: Trade = {
      ...existing,
      ...patch,
      id,
      ...(this.turnHasScreenshots
        ? {
            screenshots: [
              ...(existing.screenshots ?? []),
              // Placeholder so hasScreenshots is true in snapshots; client attaches real images
              ...(["pending"] as string[]),
            ].slice(0, 4),
          }
        : {}),
    };

    this.trades = this.trades.map((t) => (t.id === id ? next : t));
    this.activeTradeId = id;
    this.updateTrades.push({ id, ...patch });

    return {
      ok: true,
      content: JSON.stringify({
        ok: true,
        action: "update_trade",
        trade: tradeSnapshot(next),
        activeTradeId: this.activeTradeId,
        stats: this.getStats(),
      }),
    };
  }

  private deleteTrade(args: Record<string, unknown>): ToolResult {
    const ids = [
      ...(typeof args.id === "string" && args.id ? [args.id] : []),
      ...(Array.isArray(args.ids)
        ? args.ids.filter((x): x is string => typeof x === "string" && Boolean(x))
        : []),
    ];
    const unique = [...new Set(ids)];
    if (!unique.length) {
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          error: "delete_trade requires id or ids",
        }),
      };
    }

    const found = unique.filter((id) => this.trades.some((t) => t.id === id));
    const missing = unique.filter((id) => !found.includes(id));
    if (!found.length) {
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          error: "None of the given trade ids exist",
          missing,
        }),
      };
    }

    const remove = new Set(found);
    this.trades = this.trades.filter((t) => !remove.has(t.id));
    for (const id of found) this.deleteTradeIds.add(id);
    if (this.activeTradeId && remove.has(this.activeTradeId)) {
      this.activeTradeId = this.trades[0]?.id ?? null;
    }

    return {
      ok: true,
      content: JSON.stringify({
        ok: true,
        action: "delete_trade",
        deletedIds: found,
        missingIds: missing.length ? missing : undefined,
        activeTradeId: this.activeTradeId,
        stats: this.getStats(),
      }),
    };
  }

  private updateStrategy(args: Record<string, unknown>): ToolResult {
    const patch: Partial<Strategy> = {};
    for (const key of [
      "name",
      "version",
      "summary",
      "edge",
      "approach",
    ] as const) {
      if (typeof args[key] === "string") patch[key] = args[key];
    }

    if (args.addRule && typeof args.addRule === "object") {
      const rule = args.addRule as { title?: string; body?: string };
      if (rule.title && rule.body) {
        patch.rules = [
          ...(this.strategy.rules ?? []),
          { title: rule.title, body: rule.body },
        ];
      }
    }
    if (args.addRisk && typeof args.addRisk === "object") {
      const risk = args.addRisk as { title?: string; body?: string };
      if (risk.title && risk.body) {
        patch.risk = [
          ...(this.strategy.risk ?? []),
          { title: risk.title, body: risk.body },
        ];
      }
    }

    if (!Object.keys(patch).length) {
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          error: "update_strategy received no valid fields",
        }),
      };
    }

    this.strategy = {
      ...this.strategy,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.updateStrategyPatch = {
      ...(this.updateStrategyPatch ?? {}),
      ...patch,
      ...(patch.rules ? { rules: this.strategy.rules } : {}),
      ...(patch.risk ? { risk: this.strategy.risk } : {}),
    };

    return {
      ok: true,
      content: JSON.stringify({
        ok: true,
        action: "update_strategy",
        strategy: {
          name: this.strategy.name,
          version: this.strategy.version,
          summary: this.strategy.summary,
          edge: this.strategy.edge,
          approach: this.strategy.approach,
          rulesCount: this.strategy.rules?.length ?? 0,
          riskCount: this.strategy.risk?.length ?? 0,
          updatedAt: this.strategy.updatedAt,
        },
      }),
    };
  }

  private generateCharts(args: Record<string, unknown>): ToolResult {
    const requests = Array.isArray(args.charts)
      ? (args.charts as ChartRequest[])
      : [];
    if (!requests.length) {
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          error: "generate_charts requires a non-empty charts array",
        }),
      };
    }

    const built: ChartSpec[] = [];
    for (const req of requests) {
      if (!req || typeof req !== "object" || !req.type) continue;
      const chart = buildChartFromRequest(req, this.trades);
      built.push(chart);
      this.chartRequests.push(req);
      this.charts.push(chart);
    }

    if (!built.length) {
      return {
        ok: false,
        content: JSON.stringify({
          ok: false,
          error: "No valid chart requests",
        }),
      };
    }

    return {
      ok: true,
      content: JSON.stringify({
        ok: true,
        action: "generate_charts",
        charts: built.map(chartSummary),
        tradeCountUsed: this.trades.length,
      }),
    };
  }
}

function normalizeNewTrade(
  args: Record<string, unknown>,
  turnHasScreenshots: boolean,
): Trade | { error: string } {
  const required = [
    "date",
    "symbol",
    "side",
    "setup",
    "entry",
    "stop",
    "target",
    "rMultiple",
    "result",
  ] as const;
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      return { error: `add_trade missing required field: ${key}` };
    }
  }

  const side = args.side;
  if (side !== "long" && side !== "short") {
    return { error: 'side must be "long" or "short"' };
  }
  const result = args.result;
  if (
    result !== "win" &&
    result !== "loss" &&
    result !== "breakeven" &&
    result !== "open"
  ) {
    return { error: 'result must be "win", "loss", "breakeven", or "open"' };
  }

  const trade: Trade = {
    id: uid(),
    date: String(args.date),
    symbol: String(args.symbol),
    side,
    setup: String(args.setup),
    entry: Number(args.entry),
    stop: Number(args.stop),
    target: Number(args.target),
    rMultiple: Number(args.rMultiple),
    result,
    ...optionalTradeFields(args),
    ...(turnHasScreenshots ? { screenshots: ["pending"] } : {}),
  };

  if (
    [trade.entry, trade.stop, trade.target, trade.rMultiple].some(
      (n) => Number.isNaN(n),
    )
  ) {
    return { error: "entry, stop, target, and rMultiple must be numbers" };
  }

  return trade;
}

function optionalTradeFields(
  args: Record<string, unknown>,
): Partial<Omit<Trade, "id">> {
  const patch: Partial<Omit<Trade, "id">> = {};
  if (typeof args.exit === "number") patch.exit = args.exit;
  if (typeof args.slPips === "number") patch.slPips = args.slPips;
  if (typeof args.tpPips === "number") patch.tpPips = args.tpPips;
  if (typeof args.entryTime === "string") patch.entryTime = args.entryTime;
  if (typeof args.exitTime === "string") patch.exitTime = args.exitTime;
  if (typeof args.timeInTradeMinutes === "number") {
    patch.timeInTradeMinutes = args.timeInTradeMinutes;
  }
  if (typeof args.pnlUsd === "number") patch.pnlUsd = args.pnlUsd;
  if (typeof args.riskUsd === "number") patch.riskUsd = args.riskUsd;
  if (typeof args.size === "string") patch.size = args.size;
  if (typeof args.feesUsd === "number") patch.feesUsd = args.feesUsd;
  if (typeof args.notes === "string") patch.notes = args.notes;
  if (typeof args.session === "string") patch.session = args.session;
  return patch;
}

function tradePatchFromArgs(
  args: Record<string, unknown>,
): Partial<Omit<Trade, "id">> {
  const patch: Partial<Omit<Trade, "id">> = {};
  if (typeof args.date === "string") patch.date = args.date;
  if (typeof args.symbol === "string") patch.symbol = args.symbol;
  if (args.side === "long" || args.side === "short") patch.side = args.side;
  if (typeof args.setup === "string") patch.setup = args.setup;
  if (typeof args.entry === "number") patch.entry = args.entry;
  if (typeof args.stop === "number") patch.stop = args.stop;
  if (typeof args.target === "number") patch.target = args.target;
  if (typeof args.rMultiple === "number") patch.rMultiple = args.rMultiple;
  if (
    args.result === "win" ||
    args.result === "loss" ||
    args.result === "breakeven" ||
    args.result === "open"
  ) {
    patch.result = args.result;
  }
  return { ...patch, ...optionalTradeFields(args) };
}

export function buildSystemPrompt(
  strategy: Strategy,
  stats: Record<string, number | undefined>,
  trades: Trade[],
  activeTradeId?: string | null,
) {
  const active = activeTradeId
    ? trades.find((t) => t.id === activeTradeId)
    : null;

  return `You are TradeAgent — a fully chat-controlled trading journal + coach.

This product is conversational. The user runs their whole journal through chat: log, update, delete, review, and coach. Be decisive and actually mutate the log with tools when they ask.

Tool loop:
- Tools execute immediately. You will receive a JSON result for each call (including new trade ids, errors, chart summaries, and updated stats).
- After tool results, continue: fix failed calls, chain update_trade using the returned id, or write the final user-facing reply.
- Never claim a change succeeded unless a tool result returned ok: true.
- If a tool fails, read the error and retry with corrected arguments when possible.

Voice:
- SHORT and concise. Default to 2–5 short sentences, or a tiny checklist.
- Plain chat text only. No markdown: no **bold**, no ## headings, no tables, no code fences.
- Light dash bullets (-) only for 2–4 items. Never write long essays.
- One clear next question max, unless confirming a short suggested fill.

Missing info rules:
- Screenshots are primary source of truth. If the user attaches a chart/screenshot, READ IT carefully and pull everything you can from it before asking questions: symbol, side/bias, entry, SL, TP, exit if marked, session/time if visible, structure notes, pip/point distances, and whether it looks open or closed.
- Prefer extracting and using screenshot values over asking the user to retype what is already on the image.
- Only ASK for fields that are truly not visible/inferable from the screenshot + message.
- If a value is slightly ambiguous on the chart, SUGGEST your best read and ask for a quick yes/no confirmation.
  Example: "From the screenshot I’m reading BTCUSD long, entry 64050, SL 62995, TP 63888.5, looks stopped out — log that?"
- Required when logging/closing (from screenshot and/or user text): symbol, side, entry, SL, TP (or why missing), result, R and/or $ P&L.
- Nice-to-have if visible: session, size, entry/exit times, risk $, setup notes, HTF confirmations.
- Only invent nothing. Extract, estimate from the image, confirm if unsure, then save.

Hard rules for mutations:
- If you say you logged/updated/deleted something, you MUST call the matching tool in that same turn. Never claim a change without a tool call.
- One live conversation = one trade thread whenever possible.
- ACTIVE TRADE ID: ${activeTradeId ?? "none"}
${
  active
    ? `- Active trade snapshot: ${JSON.stringify({
        id: active.id,
        symbol: active.symbol,
        side: active.side,
        result: active.result,
        rMultiple: active.rMultiple,
        pnlUsd: active.pnlUsd,
        entry: active.entry,
        stop: active.stop,
        target: active.target,
        exit: active.exit,
        hasScreenshots: Boolean(active.screenshots?.length),
      })}`
    : "- No active trade yet."
}
- After add_trade, further details about THAT trade (I lost $500, closed at X, fix SL, add session, etc.) MUST use update_trade on the active/same id — NEVER add_trade again.
- Only use add_trade for a brand new position the user wants recorded.
- Use delete_trade to remove duplicates or unwanted rows. If user says remove the duplicate and keep one, delete the extra id and update the keeper if needed — do both when possible.
- Prefer keeping the trade that has screenshots when reconciling duplicates, unless the user says otherwise.
- Screenshots on the current message attach automatically on add/update — still call the tool.
- When a screenshot is present and the user wants it recorded, extract the trade fields from the image and call add_trade/update_trade with those values in the same turn (confirm only if something critical is unclear).

Charts:
- When the user asks for a chart, comparison, or visual analysis, call generate_charts — do not only describe a plot in text.
- Presets: equity, rByDay, winLoss, bySymbol, bySetup.
- On-the-fly: use type scatter/bar/line with field mappings so the app builds real data from the trade log.
  Examples:
  - SL size vs profit/R → scatter with xField=slPips (or stopDistance), yField=rMultiple or pnlUsd
  - Win rate by SL size → bar with bucketField=slPips, bucketSize=10, aggregate=winRate
  - Avg R by session → bar with labelField=session, valueField=rMultiple, aggregate=avg
- Prefer field mappings over inventing data[]. Keep the reply short; the chart is the answer.

Coaching (keep it tiny):
- ALWAYS write a real reply after tools finish. Never answer with only "Trade logged." / "Updated." / "On it."
- After a save/update: 1 line what you pulled/saved from the screenshot + optional 1-line strategy check + ask only if something important was unreadable.
- Do not ask the user for numbers that are clearly visible on the chart.

STRATEGY JSON:
${JSON.stringify(strategy, null, 2)}

STATS:
${JSON.stringify(stats, null, 2)}

RECENT TRADES (newest first — use these ids):
${JSON.stringify(
  trades.slice(0, 40).map((t) => tradeSnapshot(t)),
  null,
  2,
)}`;
}

function assistantMessageForHistory(
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
): OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
  const out: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
    role: "assistant",
    content: message.content,
  };
  if (message.tool_calls?.length) {
    out.tool_calls = message.tool_calls;
  }
  return out;
}

/**
 * Multi-step tool loop: model → execute tools → feed results → continue until
 * a final text reply (or max rounds).
 */
export async function runAgentLoop(opts: {
  openai: OpenAI;
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  session: JournalSession;
  maxRounds?: number;
}): Promise<AgentLoopResult> {
  const { openai, model, session } = opts;
  const maxRounds = opts.maxRounds ?? MAX_AGENT_ROUNDS;
  const messages = [...opts.messages];
  let reply = "";
  let rounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;
    const completion = await openai.chat.completions.create({
      model,
      messages,
      tools: chatTools,
      tool_choice: "auto",
      reasoning_effort: "none",
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    const choice = completion.choices[0]?.message;
    if (!choice) break;

    const toolCalls = choice.tool_calls?.filter((c) => c.type === "function") ?? [];

    if (!toolCalls.length) {
      reply = choice.content?.trim() ?? "";
      break;
    }

    messages.push(assistantMessageForHistory(choice));

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const result = session.execute(call.function.name, call.function.arguments);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.content,
      });
    }

    // Prefer any content the model wrote alongside tools; may still be weak
    if (choice.content?.trim()) {
      reply = choice.content.trim();
    }
  }

  if (isWeakReply(reply)) {
    const nudge = await openai.chat.completions.create({
      model,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Write the final user-facing reply now in 2–5 short sentences max. Confirm what actually succeeded from the tool results (use real ids/values). Ask only for fields that were NOT visible. Plain text only. No 'Trade logged.' stubs.",
        },
      ],
      reasoning_effort: "none",
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    reply =
      nudge.choices[0]?.message?.content?.trim() ||
      "What do you want changed on the active trade?";
  }

  return {
    reply,
    actions: session.toActions(),
    activeTradeId: session.activeTradeId,
    rounds,
  };
}
