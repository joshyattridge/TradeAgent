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
