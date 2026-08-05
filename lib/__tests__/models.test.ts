import { describe, expect, it } from "vitest";
import {
  CUSTOM_MODEL_OPTION,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_REASONING_EFFORT,
  OPENAI_MODELS,
  REASONING_EFFORTS,
  isPresetModel,
  isReasoningEffort,
  resolveModelLabel,
  resolveReasoningEffortLabel,
} from "@/lib/models";

describe("models", () => {
  it("exposes presets and defaults", () => {
    expect(OPENAI_MODELS.length).toBeGreaterThan(0);
    expect(DEFAULT_OPENAI_MODEL).toBe("gpt-5.6-luna");
    expect(CUSTOM_MODEL_OPTION).toBe("__custom__");
    expect(REASONING_EFFORTS.some((o) => o.id === "max")).toBe(true);
    expect(DEFAULT_REASONING_EFFORT).toBe("medium");
  });

  it("resolveModelLabel returns preset label or raw id", () => {
    expect(resolveModelLabel("gpt-5.6-luna")).toBe("GPT-5.6 Luna");
    expect(resolveModelLabel("my-custom-model")).toBe("my-custom-model");
  });

  it("isPresetModel distinguishes presets", () => {
    expect(isPresetModel("gpt-5.6-luna")).toBe(true);
    expect(isPresetModel("not-a-preset")).toBe(false);
  });

  it("isReasoningEffort and resolveReasoningEffortLabel cover known and unknown", () => {
    expect(isReasoningEffort("high")).toBe(true);
    expect(isReasoningEffort("nope")).toBe(false);
    expect(resolveReasoningEffortLabel("max")).toBe("Max");
    expect(resolveReasoningEffortLabel("mystery")).toBe("mystery");
  });
});
