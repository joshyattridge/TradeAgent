import { z } from "zod";

export const tradeSideSchema = z.enum(["long", "short"]);
export const tradeResultSchema = z.enum(["win", "loss", "breakeven", "open"]);

const optionalTradeFields = {
  exit: z.number().optional(),
  slPips: z.number().optional(),
  tpPips: z.number().optional(),
  entryTime: z
    .string()
    .optional()
    .describe(
      "Entry fill datetime as ISO-8601, e.g. 2026-07-30T14:52:45.000Z or 2026-07-30T15:52:45+01:00. Prefer offset/Z — not 'UTC+1' prose.",
    ),
  exitTime: z
    .string()
    .optional()
    .describe(
      "Exit fill datetime as ISO-8601, e.g. 2026-07-30T15:44:26.000Z or with +01:00 offset. Prefer offset/Z — not 'UTC+1' prose.",
    ),
  timeInTradeMinutes: z.number().optional(),
  pnlUsd: z.number().optional(),
  riskUsd: z.number().optional(),
  size: z.string().optional(),
  feesUsd: z.number().optional(),
  session: z.string().optional(),
};

/** Create a brand-new trade. Initial notes/tags allowed only on create. */
export const logTradeSchema = z.object({
  date: z.string().describe("YYYY-MM-DD"),
  symbol: z.string(),
  side: tradeSideSchema,
  setup: z.string(),
  entry: z.number(),
  stop: z.number(),
  target: z.number(),
  rMultiple: z.number(),
  result: tradeResultSchema,
  notes: z.string().optional().describe("Initial notes for a new trade only"),
  tags: z.array(z.string()).optional().describe("Initial tags for a new trade only"),
  ...optionalTradeFields,
});

/**
 * Partial field update. Never touches notes/tags — use annotate_trade for those.
 * Exact id required; no silent retargeting.
 */
export const patchTradeSchema = z.object({
  id: z.string().describe("Exact trade id from find_trade / query_trades / log_trade"),
  date: z.string().optional(),
  symbol: z
    .string()
    .optional()
    .describe("Only for correcting typos on the SAME pair — refused if pair differs"),
  side: tradeSideSchema.optional(),
  setup: z.string().optional(),
  entry: z.number().optional(),
  stop: z.number().optional(),
  target: z.number().optional(),
  rMultiple: z.number().optional(),
  result: tradeResultSchema.optional(),
  ...optionalTradeFields,
});

/**
 * Notes/tags only. Append/add/remove by default; replace* only when user asks to overwrite.
 * Empty strings / empty arrays are ignored so models that fill unused fields still succeed.
 */
export const annotateTradeSchema = z
  .object({
    id: z.string(),
    appendNote: z
      .string()
      .optional()
      .describe("Append to existing notes (preferred). Omit unused fields entirely — do not send empty strings."),
    replaceNotes: z
      .string()
      .optional()
      .describe("Overwrite notes entirely — only when user asks to rewrite/replace. Omit if unused."),
    addTags: z
      .array(z.string())
      .optional()
      .describe("Merge these tags into the trade. Omit or skip if unused."),
    removeTags: z
      .array(z.string())
      .optional()
      .describe("Remove these tags (case-insensitive). Omit if unused."),
    replaceTags: z
      .array(z.string())
      .optional()
      .describe("Replace the full tag list — only when user asks to overwrite tags. Omit if unused."),
  })
  .transform((v) => {
    const appendNote = v.appendNote?.trim() ? v.appendNote : undefined;
    const addTags = (v.addTags ?? []).map((t) => t.trim()).filter(Boolean);
    const removeTags = (v.removeTags ?? []).map((t) => t.trim()).filter(Boolean);
    const hasAdd = addTags.length > 0;
    const hasRemove = removeTags.length > 0;
    const hasReplaceNotesContent =
      typeof v.replaceNotes === "string" && v.replaceNotes.trim() !== "";
    const replaceTagsCleaned = (v.replaceTags ?? [])
      .map((t) => t.trim())
      .filter(Boolean);
    const hasReplaceTagsContent = replaceTagsCleaned.length > 0;

    const hasNoteContent = Boolean(appendNote) || hasReplaceNotesContent;
    const hasTagContent = hasAdd || hasRemove || hasReplaceTagsContent;

    // Empty replaceNotes is LLM filler unless it is the ONLY op (clear notes).
    let replaceNotes: string | undefined;
    if (hasReplaceNotesContent) {
      replaceNotes = v.replaceNotes;
    } else if (
      v.replaceNotes !== undefined &&
      v.replaceNotes.trim() === "" &&
      !appendNote &&
      !hasTagContent
    ) {
      replaceNotes = "";
    }

    // Empty replaceTags is LLM filler unless it is the ONLY op (clear tags).
    let replaceTags: string[] | undefined;
    if (hasReplaceTagsContent) {
      replaceTags = replaceTagsCleaned;
    } else if (
      v.replaceTags !== undefined &&
      replaceTagsCleaned.length === 0 &&
      !hasAdd &&
      !hasRemove &&
      !hasNoteContent
    ) {
      replaceTags = [];
    }

    return {
      id: v.id,
      appendNote,
      replaceNotes,
      addTags: hasAdd ? addTags : undefined,
      removeTags: hasRemove ? removeTags : undefined,
      replaceTags,
    };
  })
  .refine(
    (v) =>
      v.appendNote !== undefined ||
      v.replaceNotes !== undefined ||
      (v.addTags && v.addTags.length > 0) ||
      (v.removeTags && v.removeTags.length > 0) ||
      v.replaceTags !== undefined,
    {
      message:
        "Provide at least one of: appendNote, replaceNotes, addTags, removeTags, replaceTags",
    },
  )
  .refine((v) => !(v.appendNote !== undefined && v.replaceNotes !== undefined), {
    message: "Use either appendNote or replaceNotes, not both",
  })
  .refine((v) => !(v.replaceTags !== undefined && (v.addTags?.length || v.removeTags?.length)), {
    message: "Use replaceTags alone, or addTags/removeTags — not both styles",
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
  replacements: z
    .array(
      z.object({
        find: z
          .string()
          .min(1)
          .describe(
            "Exact text to find in the CURRENT strategy markdown (copy from get_strategy)",
          ),
        replace: z
          .string()
          .describe("Replacement text (use empty string to delete the found text)"),
        replaceAll: z
          .boolean()
          .optional()
          .describe("If true, replace every occurrence; default false (must be unique)"),
      }),
    )
    .optional()
    .describe(
      "PREFERRED for small edits: surgical find/replace on the current markdown. Call get_strategy first.",
    ),
  appendMarkdown: z
    .string()
    .optional()
    .describe("Append a new section to the end of the strategy document"),
  markdown: z
    .string()
    .optional()
    .describe(
      "FULL document replace only — must be the entire strategy from get_strategy with edits applied. Never pass a short snippet here.",
    ),
  name: z
    .string()
    .optional()
    .describe("Optional display name override (defaults from first H1)"),
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

export const getStrategySchema = z.object({
  // Kept for backwards-compatible tool calls; always returns the full markdown.
  section: z
    .enum(["all", "summary", "rules", "risk", "targets", "timeframes"])
    .optional()
    .default("all")
    .describe("Ignored — always returns the full strategy markdown"),
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

export type LogTradeInput = z.infer<typeof logTradeSchema>;
export type PatchTradeInput = z.infer<typeof patchTradeSchema>;
export type AnnotateTradeInput = z.infer<typeof annotateTradeSchema>;
export type TradeFilterInput = z.infer<typeof tradeFilterSchema>;
export type QueryTradesInput = z.infer<typeof queryTradesSchema>;
export type GetStrategyInput = z.infer<typeof getStrategySchema>;
export type GetTradeInput = z.infer<typeof getTradeSchema>;
export type FindTradeInput = z.infer<typeof findTradeSchema>;

/** @deprecated Use LogTradeInput */
export type AddTradeInput = LogTradeInput;
