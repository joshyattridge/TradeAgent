"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  backupFilename,
  buildJournalBackup,
  parseJournalBackup,
  serializeJournalBackup,
  type ImportMode,
} from "@/lib/backup";
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
  type PresetOpenAIModelId,
  type ReasoningEffortId,
} from "@/lib/models";
import { useTradingStore } from "@/lib/store";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function SettingsPage() {
  const hydrated = useTradingStore((s) => s.hydrated);
  const savedKey = useTradingStore((s) => s.openaiApiKey);
  const savedModel = useTradingStore((s) => s.openaiModel);
  const savedReasoningEffort = useTradingStore((s) => s.openaiReasoningEffort);
  const trades = useTradingStore((s) => s.trades);
  const strategy = useTradingStore((s) => s.strategy);
  const setOpenAIApiKey = useTradingStore((s) => s.setOpenAIApiKey);
  const setOpenAIModel = useTradingStore((s) => s.setOpenAIModel);
  const setOpenAIReasoningEffort = useTradingStore(
    (s) => s.setOpenAIReasoningEffort,
  );
  const importJournal = useTradingStore((s) => s.importJournal);

  const [apiKey, setApiKey] = useState("");
  const [selection, setSelection] = useState<string>(DEFAULT_OPENAI_MODEL);
  const [customModel, setCustomModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<string>(
    DEFAULT_REASONING_EFFORT,
  );
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const [importMode, setImportMode] = useState<ImportMode>("replace");
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setReasoningEffort(
      isReasoningEffort(savedReasoningEffort)
        ? savedReasoningEffort
        : DEFAULT_REASONING_EFFORT,
    );
  }, [hydrated, savedKey, savedModel, savedReasoningEffort]);

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
    setOpenAIReasoningEffort(
      (isReasoningEffort(reasoningEffort)
        ? reasoningEffort
        : DEFAULT_REASONING_EFFORT) as ReasoningEffortId,
    );
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

  function onExportBackup() {
    setBackupError(null);
    const backup = buildJournalBackup(trades, strategy);
    const blob = new Blob([serializeJournalBackup(backup)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFilename(new Date(backup.exportedAt));
    a.click();
    URL.revokeObjectURL(url);
    setBackupStatus(
      `Downloaded backup with ${trades.length} trade${trades.length === 1 ? "" : "s"} + strategy.`,
    );
  }

  async function onImportFile(file: File) {
    setBackupError(null);
    setBackupStatus(null);

    let text: string;
    try {
      text = await file.text();
    } catch {
      setBackupError("Could not read that file.");
      return;
    }

    const parsed = parseJournalBackup(text);
    if (!parsed.ok) {
      setBackupError(parsed.error);
      return;
    }

    const { backup } = parsed;
    if (importMode === "replace") {
      const ok = window.confirm(
        `Replace your current journal with this backup?\n\n` +
          `${backup.trades.length} trade${backup.trades.length === 1 ? "" : "s"} + strategy from ${backup.exportedAt.slice(0, 10)}.\n\n` +
          `Your current trades and strategy will be overwritten. Chat and API key are unchanged.`,
      );
      if (!ok) return;
    }

    importJournal(backup.trades, backup.strategy, importMode);
    const tradeWord = backup.trades.length === 1 ? "trade" : "trades";
    setBackupStatus(
      importMode === "replace"
        ? `Restored ${backup.trades.length} ${tradeWord} and strategy.`
        : `Merged ${backup.trades.length} ${tradeWord} and updated strategy.`,
    );
    if (fileInputRef.current) fileInputRef.current.value = "";
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
          the floating chat across dashboard, logs, strategy, and calculator.
        </p>
      </section>

      <section className="settings-form panel settings-section">
        <h2>Appearance</h2>
        <p>
          System follows your computer. Choose Light or Dark to lock the palette.
        </p>
        <div className="field">
          <span className="field__label">Theme</span>
          <ThemeToggle labels />
          <span className="field__hint">
            Default is System. Your choice is stored in this browser.
          </span>
        </div>
      </section>

      <form className="settings-form panel" onSubmit={onSave}>
        <div className="settings-status">
          <span className={`status-dot${connected ? " is-on" : ""}`} />
          <p>
            {connected
              ? `Connected · ${resolveModelLabel(savedModel)} · ${resolveReasoningEffortLabel(savedReasoningEffort)} reasoning`
              : "No API key — chat won't work until you add one"}
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
            Stored in your browser (IndexedDB). Never committed to git.
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
            aria-label="Model"
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

        <label className="field">
          <span className="field__label">Reasoning effort</span>
          <select
            aria-label="Reasoning effort"
            value={reasoningEffort}
            onChange={(e) => setReasoningEffort(e.target.value)}
          >
            {REASONING_EFFORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.hint}
              </option>
            ))}
          </select>
          <span className="field__hint">
            How hard the model thinks before answering. Medium is the recommended
            default; Max is slowest and most expensive.
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

      <section className="settings-form panel settings-backup">
        <h2>Backup &amp; restore</h2>
        <p>
          Download your trades and strategy as a JSON file, or restore from a
          previous backup. Chat history and your API key are not included.
        </p>

        <div className="settings-actions">
          <button type="button" className="primary-btn" onClick={onExportBackup}>
            Download backup
          </button>
          <span className="field__hint">
            {trades.length} trade{trades.length === 1 ? "" : "s"} · {strategy.name}
          </span>
        </div>

        <label className="field">
          <span className="field__label">Import mode</span>
          <select
            aria-label="Import mode"
            value={importMode}
            onChange={(e) => setImportMode(e.target.value as ImportMode)}
          >
            <option value="replace">Replace — overwrite current trades &amp; strategy</option>
            <option value="merge">
              Merge — keep existing trades; same IDs update; add new ones
            </option>
          </select>
          <span className="field__hint">
            Strategy is always taken from the backup on import. Screenshots
            embedded in trades are included when present.
          </span>
        </label>

        <div className="settings-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            id="backup-import"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImportFile(file);
            }}
          />
          <label htmlFor="backup-import" className="ghost-btn settings-file-btn">
            Choose backup file…
          </label>
        </div>

        {backupStatus ? <p className="save-flash">{backupStatus}</p> : null}
        {backupError ? <p className="settings-backup-error">{backupError}</p> : null}
      </section>
    </div>
  );
}
