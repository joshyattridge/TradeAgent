export const OPENAI_MODELS = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", hint: "Fast + cheap — great default" },
  { id: "gpt-4.1", label: "GPT-4.1", hint: "Stronger reasoning" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", hint: "Fast multimodal" },
  { id: "gpt-4o", label: "GPT-4o", hint: "Higher quality" },
  { id: "o4-mini", label: "o4 Mini", hint: "Reasoning, lighter cost" },
  { id: "o3-mini", label: "o3 Mini", hint: "Deep reasoning" },
] as const;

export type OpenAIModelId = (typeof OPENAI_MODELS)[number]["id"];

export const DEFAULT_OPENAI_MODEL: OpenAIModelId = "gpt-4.1-mini";
