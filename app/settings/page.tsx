"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  CUSTOM_MODEL_OPTION,
  DEFAULT_OPENAI_MODEL,
  OPENAI_MODELS,
  isPresetModel,
  resolveModelLabel,
  type PresetOpenAIModelId,
} from "@/lib/models";
import { useTradingStore } from "@/lib/store";

export default function SettingsPage() {
  const hydrated = useTradingStore((s) => s.hydrated);
  const savedKey = useTradingStore((s) => s.openaiApiKey);
  const savedModel = useTradingStore((s) => s.openaiModel);
  const setOpenAIApiKey = useTradingStore((s) => s.setOpenAIApiKey);
  const setOpenAIModel = useTradingStore((s) => s.setOpenAIModel);

  const [apiKey, setApiKey] = useState("");
  const [selection, setSelection] = useState<string>(DEFAULT_OPENAI_MODEL);
  const [customModel, setCustomModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    setApiKey(savedKey);
    if (isPresetModel(savedModel)) {
      setSelection(savedModel);
      setCustomModel("");
    } else if (savedModel) {
      setSelection(CUSTOM_MODEL_OPTION);
      setCustomModel(savedModel);
    } else {
      setSelection(DEFAULT_OPENAI_MODEL);
      setCustomModel("");
    }
  }, [hydrated, savedKey, savedModel]);

  const isCustom = selection === CUSTOM_MODEL_OPTION;

  function onSave(e: FormEvent) {
    e.preventDefault();
    if (isCustom) {
      const id = customModel.trim();
      if (!id) return;
      setOpenAIModel(id);
    } else {
      setOpenAIModel(selection as PresetOpenAIModelId);
    }
    setOpenAIApiKey(apiKey);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  function onClearKey() {
    setApiKey("");
    setOpenAIApiKey("");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  if (!hydrated) {
    return (
      <div className="page">
        <p className="empty-note">Loading settings…</p>
      </div>
    );
  }

  const connected = Boolean(savedKey);

  return (
    <div className="page">
      <section className="page-hero">
        <h1>Settings</h1>
        <p>
          Drop in your OpenAI API key and pick a model. TradeAgent uses these for
          the floating chat across dashboard, logs, and strategy.
        </p>
      </section>

      <form className="settings-form panel" onSubmit={onSave}>
        <div className="settings-status">
          <span className={`status-dot${connected ? " is-on" : ""}`} />
          <p>
            {connected
              ? `Connected · ${resolveModelLabel(savedModel)}`
              : "No API key yet — chat falls back to the local parser"}
          </p>
        </div>

        <label className="field">
          <span className="field__label">OpenAI API key</span>
          <div className="field__row">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <span className="field__hint">
            Stored only in your browser (localStorage). Never committed to git.
            Get a key from{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
            >
              platform.openai.com
            </a>
            .
          </span>
        </label>

        <label className="field">
          <span className="field__label">Model</span>
          <select
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
          >
            {OPENAI_MODELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.hint}
              </option>
            ))}
            <option value={CUSTOM_MODEL_OPTION}>Custom</option>
          </select>
          <span className="field__hint">
            Latest GPT-5.6 family. Luna is the everyday pick; Sol for deeper trade
            reviews. Choose Custom to type any OpenAI model ID.
          </span>
        </label>

        {isCustom ? (
          <label className="field field--custom">
            <span className="field__label">Custom model ID</span>
            <input
              type="text"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="e.g. gpt-5.6-sol or ft:…"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <span className="field__hint">
              Exact API model string from OpenAI (or a fine-tuned model).
            </span>
          </label>
        ) : null}

        <div className="settings-actions">
          <button type="submit" className="primary-btn">
            Save settings
          </button>
          {savedKey ? (
            <button type="button" className="ghost-btn" onClick={onClearKey}>
              Clear key
            </button>
          ) : null}
          {saved ? <span className="save-flash">Saved</span> : null}
        </div>

        <p className="settings-foot">
          After saving, open the chat and ask something like{" "}
          <Link href="/">“show my equity curve”</Link>.
        </p>
      </form>
    </div>
  );
}
