import { z } from "zod";

export const tradeSideSchema = z.enum(["long", "short"]);
export const tradeResultSchema = z.enum(["win", "loss", "breakeven", "open"]);

export const chartExtractSchema = z
  .object({
    levels: z
      .object({
        entry: z.number().optional(),
        stop: z.number().optional(),
        target: z.number().optional(),
        exit: z.number().optional(),
      })
      .optional(),
    setupTags: z.array(z.string()).optional(),
    bias: z.string().optional(),
    sessionGuess: z.string().optional(),
    notes: z.string().optional(),
    extractedAt: z.string().optional(),
  })
  .optional();

const optionalTradeFields = {
  exit: z.number().optional(),
  slPips: z.number().optional(),
  tpPips: z.number().optional(),
  entryTime: z.string().optional(),
  exitTime: z.string().optional(),
  timeInTradeMinutes: z.number().optional(),
  pnlUsd: z.number().optional(),
  riskUsd: z.number().optional(),
  size: z.string().optional(),
  feesUsd: z.number().optional(),
  notes: z.string().optional(),
  session: z.string().optional(),
  tags: z.array(z.string()).optional(),
  chartExtract: chartExtractSchema,
};

export const addTradeSchema = z.object({
  date: z.string().describe("YYYY-MM-DD"),
  symbol: z.string(),
  side: tradeSideSchema,
  setup: z.string(),
  entry: z.number(),
  stop: z.number(),
  target: z.number(),
  rMultiple: z.number(),
  result: tradeResultSchema,
  ...optionalTradeFields,
});

export const updateTradeSchema = z.object({
  id: z.string(),
  date: z.string().optional(),
  symbol: z.string().optional(),
  side: tradeSideSchema.optional(),
  setup: z.string().optional(),
  entry: z.number().optional(),
  stop: z.number().optional(),
  target: z.number().optional(),
  rMultiple: z.number().optional(),
  result: tradeResultSchema.optional(),
  appendNote: z
    .string()
    .optional()
    .describe("Append to existing notes instead of replacing"),
  appendTags: z
    .array(z.string())
    .optional()
    .describe("Merge these tags into the trade"),
  ...optionalTradeFields,
});

export const deleteTradeSchema = z
  .object({
    id: z.string().optional(),
    ids: z.array(z.string()).optional(),
  })
  .refine((v) => Boolean(v.id) || (v.ids && v.ids.length > 0), {
    message: "Provide id or ids",
  });

export const updateStrategySchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  summary: z.string().optional(),
  edge: z.string().optional(),
  approach: z.string().optional(),
  addRule: z
    .object({
      title: z.string(),
      body: z.string(),
    })
    .optional(),
  addRisk: z
    .object({
      title: z.string(),
      body: z.string(),
    })
    .optional(),
});

const metricField = z.enum([
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
]);

const labelField = z.enum([
  "symbol",
  "date",
  "setup",
  "session",
  "side",
  "result",
]);

export const chartRequestSchema = z.object({
  type: z.enum([
    "equity",
    "rByDay",
    "winLoss",
    "bySymbol",
    "bySetup",
    "bar",
    "scatter",
    "line",
  ]),
  title: z.string().optional(),
  description: z.string().optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
  xField: metricField.optional(),
  yField: metricField.optional(),
  valueField: metricField.optional(),
  labelField: labelField.optional(),
  aggregate: z.enum(["sum", "avg", "count", "winRate"]).optional(),
  bucketField: metricField.optional(),
  bucketSize: z.number().optional(),
  closedOnly: z.boolean().optional(),
  data: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
        secondary: z.number().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
    )
    .optional(),
});

export const generateChartsSchema = z.object({
  charts: z.array(chartRequestSchema).min(1),
});

export const tradeFilterSchema = z.object({
  symbol: z.string().optional(),
  side: tradeSideSchema.optional(),
  result: tradeResultSchema.optional(),
  setup: z.string().optional(),
  session: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  text: z
    .string()
    .optional()
    .describe("Search notes, setup, tags, symbol"),
  ids: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export const queryTradesSchema = tradeFilterSchema.extend({
  sort: z
    .enum(["newest", "oldest", "bestR", "worstR"])
    .optional()
    .default("newest"),
  limit: z.number().int().min(1).max(25).optional().default(10),
});

export const getStatsSchema = tradeFilterSchema.extend({
  closedOnly: z.boolean().optional(),
});

export const bulkUpdateTradesSchema = z.object({
  ids: z.array(z.string()).min(1).max(40),
  patch: z.object({
    setup: z.string().optional(),
    session: z.string().optional(),
    result: tradeResultSchema.optional(),
    notes: z.string().optional(),
    appendNote: z.string().optional(),
    tags: z.array(z.string()).optional(),
    appendTags: z.array(z.string()).optional(),
    side: tradeSideSchema.optional(),
  }),
});

export const compareToStrategySchema = z.object({
  ids: z.array(z.string()).optional(),
  symbol: z.string().optional(),
  side: tradeSideSchema.optional(),
  result: tradeResultSchema.optional(),
  setup: z.string().optional(),
  session: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  text: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(15).optional().default(5),
});

export const addTradeNoteSchema = z.object({
  id: z.string(),
  note: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

export const getStrategySchema = z.object({
  section: z
    .enum(["all", "summary", "rules", "risk", "targets", "timeframes"])
    .optional()
    .default("all")
    .describe("Which part of the strategy to return"),
});

export const getTradeSchema = z.object({
  id: z.string().describe("Trade id to fetch"),
});

export const findTradeSchema = z.object({
  symbol: z.string().optional().describe("Pair to search, e.g. AUDUSD"),
  side: tradeSideSchema.optional(),
  result: tradeResultSchema.optional(),
  date: z.string().optional().describe("YYYY-MM-DD if known"),
  entry: z.number().optional().describe("Entry price from screenshot/message"),
  stop: z.number().optional(),
  target: z.number().optional(),
  exit: z.number().optional(),
  size: z.string().optional(),
  pnlUsd: z.number().optional(),
  entryTime: z.string().optional(),
  exitTime: z.string().optional(),
  text: z
    .string()
    .optional()
    .describe("Ticket number or unique note fragment"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(15)
    .optional()
    .default(8)
    .describe("How many ranked candidates to return"),
});

export type AddTradeInput = z.infer<typeof addTradeSchema>;
export type UpdateTradeInput = z.infer<typeof updateTradeSchema>;
export type TradeFilterInput = z.infer<typeof tradeFilterSchema>;
export type QueryTradesInput = z.infer<typeof queryTradesSchema>;
export type GetStrategyInput = z.infer<typeof getStrategySchema>;
export type GetTradeInput = z.infer<typeof getTradeSchema>;
export type FindTradeInput = z.infer<typeof findTradeSchema>;
