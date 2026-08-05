export const OPENAI_MODELS = [
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    hint: "Fast + cheap — best daily default",
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    hint: "Balanced intelligence and cost",
  },
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    hint: "Flagship reasoning / complex reviews",
  },
  {
    id: "gpt-5.6",
    label: "GPT-5.6",
    hint: "Alias → Sol",
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    hint: "Previous gen, still strong",
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    hint: "Solid all-rounder",
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    hint: "Lighter / cheaper 5.4",
  },
  {
    id: "gpt-5.4-nano",
    label: "GPT-5.4 Nano",
    hint: "Cheapest high-volume option",
  },
] as const;

export type PresetOpenAIModelId = (typeof OPENAI_MODELS)[number]["id"];

/** Any preset ID or a custom model string from Settings. */
export type OpenAIModelId = string;

export const DEFAULT_OPENAI_MODEL: PresetOpenAIModelId = "gpt-5.6-luna";

export const CUSTOM_MODEL_OPTION = "__custom__";

export function resolveModelLabel(model: string) {
  const preset = OPENAI_MODELS.find((m) => m.id === model);
  return preset?.label ?? model;
}

export function isPresetModel(model: string): model is PresetOpenAIModelId {
  return OPENAI_MODELS.some((m) => m.id === model);
}

/** OpenAI reasoning_effort — GPT-5.6 supports up through `max`. */
export const REASONING_EFFORTS = [
  {
    id: "none",
    label: "None",
    hint: "Fastest — no extended thinking",
  },
  {
    id: "minimal",
    label: "Minimal",
    hint: "Slight thinking, still snappy",
  },
  {
    id: "low",
    label: "Low",
    hint: "Light reasoning for simple asks",
  },
  {
    id: "medium",
    label: "Medium",
    hint: "Best everyday balance (recommended)",
  },
  {
    id: "high",
    label: "High",
    hint: "Harder analysis and multi-step reviews",
  },
  {
    id: "xhigh",
    label: "Extra high",
    hint: "Deep research — slower and costlier",
  },
  {
    id: "max",
    label: "Max",
    hint: "Maximum reasoning — slowest / highest cost",
  },
] as const;

export type ReasoningEffortId = (typeof REASONING_EFFORTS)[number]["id"];

/** Eval-backed default after medium clearly beat none on hard journal asks. */
export const DEFAULT_REASONING_EFFORT: ReasoningEffortId = "medium";

export function isReasoningEffort(value: string): value is ReasoningEffortId {
  return REASONING_EFFORTS.some((o) => o.id === value);
}

export function resolveReasoningEffortLabel(effort: string) {
  const preset = REASONING_EFFORTS.find((o) => o.id === effort);
  return preset?.label ?? effort;
}
