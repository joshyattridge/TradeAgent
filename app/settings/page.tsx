"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
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
  const [preset, setPreset] = useState<PresetOpenAIModelId>(DEFAULT_OPENAI_MODEL);
  const [customModel, setCustomModel] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    setApiKey(savedKey);
    if (isPresetModel(savedModel)) {
      setPreset(savedModel);
      setCustomModel("");
      setUseCustom(false);
    } else if (savedModel) {
      setPreset(DEFAULT_OPENAI_MODEL);
      setCustomModel(savedModel);
      setUseCustom(true);
    } else {
      setPreset(DEFAULT_OPENAI_MODEL);
      setCustomModel("");
      setUseCustom(false);
    }
  }, [hydrated, savedKey, savedModel]);

  function onSave(e: FormEvent) {
    e.preventDefault();
    if (useCustom) {
      const id = customModel.trim();
      if (!id) return;
      setOpenAIModel(id);
    } else {
      setOpenAIModel(preset);
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

        <label className={`field${useCustom ? " is-dimmed" : ""}`}>
          <span className="field__label">Model</span>
          <select
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value as PresetOpenAIModelId);
              setUseCustom(false);
            }}
            disabled={useCustom}
          >
            {OPENAI_MODELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.hint}
              </option>
            ))}
          </select>
          <span className="field__hint">
            Latest GPT-5.6 family. Luna is the everyday pick; Sol for deeper trade
            reviews.
          </span>
        </label>

        <details className="settings-advanced" open={useCustom || undefined}>
          <summary>Advanced</summary>
          {!useCustom ? (
            <button
              type="button"
              className="advanced-link"
              onClick={() => setUseCustom(true)}
            >
              Use a custom OpenAI model ID
            </button>
          ) : (
            <label className="field field--custom">
              <span className="field__label">Custom model ID</span>
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="e.g. gpt-5.6-sol or ft:…"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="field__hint">
                Exact API model string. Overrides the preset dropdown.{" "}
                <button
                  type="button"
                  className="advanced-link"
                  onClick={() => {
                    setUseCustom(false);
                    setCustomModel("");
                  }}
                >
                  Back to presets
                </button>
              </span>
            </label>
          )}
        </details>

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
