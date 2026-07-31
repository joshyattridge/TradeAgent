"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { format, parseISO } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fileToChatImage } from "@/lib/images";
import {
  insertMarkdownImage,
  strategyNameFromMarkdown,
} from "@/lib/strategy-md";
import { useTradingStore } from "@/lib/store";

export default function StrategyPage() {
  const strategy = useTradingStore((s) => s.strategy);
  const hydrated = useTradingStore((s) => s.hydrated);
  const replaceStrategy = useTradingStore((s) => s.replaceStrategy);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(strategy.markdown);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(strategy.markdown);
      setDirty(false);
      setImageError(null);
    }
  }, [strategy.markdown, editing]);

  if (!hydrated) {
    return (
      <div className="page">
        <p className="empty-note">Loading strategy…</p>
      </div>
    );
  }

  function startEdit() {
    setDraft(strategy.markdown);
    setDirty(false);
    setImageError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(strategy.markdown);
    setDirty(false);
    setImageError(null);
    setEditing(false);
  }

  function save() {
    setSaving(true);
    const markdown = draft;
    replaceStrategy({
      name: strategyNameFromMarkdown(markdown, strategy.name),
      markdown,
      updatedAt: new Date().toISOString(),
    });
    setDirty(false);
    setSaving(false);
    setEditing(false);
  }

  function onDraftChange(value: string) {
    setDraft(value);
    setDirty(value !== strategy.markdown);
  }

  async function insertImageFile(file: File) {
    setImageError(null);
    try {
      const dataUrl = await fileToChatImage(file, 1400, 0.78);
      const el = textareaRef.current;
      const cursor = el?.selectionStart ?? draft.length;
      const alt = file.name.replace(/\.[^.]+$/, "") || "strategy image";
      const next = insertMarkdownImage(draft, cursor, dataUrl, alt);
      onDraftChange(next.markdown);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(next.cursor, next.cursor);
      });
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Could not add image");
    }
  }

  async function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await insertImageFile(file);
  }

  async function onDrop(e: DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const file = [...e.dataTransfer.files].find((f) =>
      f.type.startsWith("image/"),
    );
    if (file) await insertImageFile(file);
  }

  return (
    <div className="page">
      <section className="page-hero page-hero--split">
        <div>
          <h1>Strategy</h1>
          <p>
            Your trading plan as a simple markdown doc — edit freely, drop in
            chart images, and chat reads the whole thing.
          </p>
        </div>
        <div className="strategy-actions">
          {editing ? (
            <>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                Add image
              </button>
              <button type="button" className="ghost-btn" onClick={cancelEdit}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={save}
                disabled={!dirty || saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button type="button" className="primary-btn" onClick={startEdit}>
              Edit
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={onPickImage}
          />
        </div>
      </section>

      <div className="strategy-meta">
        <span className="pill">{strategy.name}</span>
        <span className="pill">
          Updated {format(parseISO(strategy.updatedAt), "MMM d, yyyy")}
        </span>
        {dirty ? <span className="pill pill--warn">Unsaved</span> : null}
      </div>

      {imageError ? <p className="strategy-error">{imageError}</p> : null}

      {editing ? (
        <section className="strategy-editor panel">
          <textarea
            ref={textareaRef}
            className="strategy-editor__textarea"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            spellCheck
            aria-label="Strategy markdown"
            placeholder="# My strategy&#10;&#10;Write your plan in markdown…"
          />
          <p className="strategy-editor__hint">
            Markdown supported. Drag an image onto the editor or use Add image —
            it inserts <code>![alt](…)</code> at the cursor.
          </p>
        </section>
      ) : (
        <article className="strategy-doc panel">
          {strategy.markdown.trim() ? (
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {strategy.markdown}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="empty-note">
              No strategy yet. Click Edit and write your plan in markdown.
            </p>
          )}
        </article>
      )}
    </div>
  );
}
