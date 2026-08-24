"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { format, parseISO } from "date-fns";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fileToChatImage } from "@/lib/images";
import {
  insertMarkdownImage,
  joinStrategyImages,
  splitStrategyImages,
  strategyNameFromMarkdown,
} from "@/lib/strategy-md";
import { reorderChecklistItems } from "@/lib/checklist";
import { useTradingStore } from "@/lib/store";
import type { StrategyChecklistItem } from "@/lib/types";

function cloneChecklist(items: StrategyChecklistItem[] | undefined) {
  return (items ?? []).map((item) => ({ ...item }));
}

export default function StrategyPage() {
  const strategy = useTradingStore((s) => s.strategy);
  const hydrated = useTradingStore((s) => s.hydrated);
  const replaceStrategy = useTradingStore((s) => s.replaceStrategy);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(strategy.markdown);
  const [checklistDraft, setChecklistDraft] = useState<StrategyChecklistItem[]>(
    () => cloneChecklist(strategy.checklist),
  );
  const [dirty, setDirty] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const split = splitStrategyImages(draft);

  useEffect(() => {
    if (!editing) {
      setDraft(strategy.markdown);
      setChecklistDraft(cloneChecklist(strategy.checklist));
      setDirty(false);
      setImageError(null);
    }
  }, [strategy.markdown, strategy.checklist, editing]);

  if (!hydrated) {
    return (
      <div className="page">
        <p className="empty-note">Loading strategy…</p>
      </div>
    );
  }

  function markDirty(
    nextMarkdown: string,
    nextChecklist: StrategyChecklistItem[],
  ) {
    const mdDirty = nextMarkdown !== strategy.markdown;
    const clDirty =
      JSON.stringify(nextChecklist) !==
      JSON.stringify(strategy.checklist ?? []);
    setDirty(mdDirty || clDirty);
  }

  function startEdit() {
    setDraft(strategy.markdown);
    setChecklistDraft(cloneChecklist(strategy.checklist));
    setDirty(false);
    setImageError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setDraft(strategy.markdown);
    setChecklistDraft(cloneChecklist(strategy.checklist));
    setDirty(false);
    setImageError(null);
    setEditing(false);
  }

  function save() {
    const markdown = draft;
    const checklist = checklistDraft
      .map((item) => ({
        id: item.id.trim(),
        label: item.label.trim(),
      }))
      .filter((item) => item.id && item.label);
    replaceStrategy({
      name: strategyNameFromMarkdown(markdown, strategy.name),
      markdown,
      checklist,
      updatedAt: new Date().toISOString(),
    });
    setDirty(false);
    setEditing(false);
  }

  function onDraftChange(value: string) {
    setDraft(joinStrategyImages(value, split.images));
    markDirty(joinStrategyImages(value, split.images), checklistDraft);
  }

  function onChecklistChange(next: StrategyChecklistItem[]) {
    setChecklistDraft(next);
    markDirty(draft, next);
  }

  function addChecklistItem() {
    onChecklistChange([
      ...checklistDraft,
      { id: crypto.randomUUID(), label: "" },
    ]);
  }

  function updateChecklistLabel(id: string, label: string) {
    onChecklistChange(
      checklistDraft.map((item) =>
        item.id === id ? { ...item, label } : item,
      ),
    );
  }

  function removeChecklistItem(id: string) {
    onChecklistChange(checklistDraft.filter((item) => item.id !== id));
  }

  function moveChecklistItem(id: string, direction: -1 | 1) {
    onChecklistChange(reorderChecklistItems(checklistDraft, id, direction));
  }

  async function insertImageFile(file: File) {
    setImageError(null);
    try {
      const dataUrl = await fileToChatImage(file, 1400, 0.78);
      const el = textareaRef.current;
      const displayCursor = el?.selectionStart ?? split.display.length;
      const before = joinStrategyImages(
        split.display.slice(0, displayCursor),
        split.images,
      );
      const alt = file.name.replace(/\.[^.]+$/, "") || "strategy image";
      const next = insertMarkdownImage(draft, before.length, dataUrl, alt);
      setDraft(next.markdown);
      markDirty(next.markdown, checklistDraft);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        ta?.focus();
        const mapped = splitStrategyImages(next.markdown);
        ta?.setSelectionRange(mapped.display.length, mapped.display.length);
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

  const viewChecklist = strategy.checklist ?? [];

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
                disabled={!dirty}
              >
                Save
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
        {viewChecklist.length ? (
          <span className="pill">{viewChecklist.length} checklist</span>
        ) : null}
        {dirty ? <span className="pill pill--warn">Unsaved</span> : null}
      </div>

      {imageError ? <p className="strategy-error">{imageError}</p> : null}

      {editing ? (
        <section className="strategy-editor panel">
          {split.images.length ? (
            <div className="strategy-editor__images">
              {split.images.map((image) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={image.id}
                  src={image.dataUrl}
                  alt={image.alt}
                  className="strategy-editor__img"
                />
              ))}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            className="strategy-editor__textarea"
            value={split.display}
            onChange={(e) => onDraftChange(e.target.value)}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            spellCheck
            aria-label="Strategy markdown"
            placeholder="# My strategy&#10;&#10;Write your plan in markdown…"
          />
          <p className="strategy-editor__hint">
            Markdown supported. Drag an image onto the editor or use Add image —
            images render above, not as base64 text.
          </p>
        </section>
      ) : (
        <article className="strategy-doc panel">
          {strategy.markdown.trim() ? (
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) => url}
                components={{
                  img: ({ src, alt }) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={alt ?? ""} className="strategy-doc__img" />
                  ),
                }}
              >
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

      <section className="strategy-checklist panel">
        <div className="strategy-checklist__header">
          <div>
            <h2>Checklist</h2>
            <p>
              Pre-trade steps to tick off. Completed items are recorded on every
              trade.
            </p>
          </div>
          {editing ? (
            <button
              type="button"
              className="ghost-btn"
              onClick={addChecklistItem}
            >
              <Plus size={14} />
              Add item
            </button>
          ) : null}
        </div>

        {editing ? (
          checklistDraft.length ? (
            <ul className="strategy-checklist__list">
              {checklistDraft.map((item, index) => (
                <li key={item.id} className="strategy-checklist__item">
                  <span
                    className="strategy-checklist__mark"
                    aria-hidden
                  />
                  <input
                    type="text"
                    className="strategy-checklist__input"
                    value={item.label}
                    onChange={(e) =>
                      updateChecklistLabel(item.id, e.target.value)
                    }
                    placeholder="Checklist item…"
                    aria-label={`Checklist item ${index + 1}`}
                  />
                  <div className="strategy-checklist__row-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => moveChecklistItem(item.id, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => moveChecklistItem(item.id, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => removeChecklistItem(item.id)}
                      aria-label="Remove item"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-note">
              No checklist items yet. Add the steps you want to verify before
              every trade.
            </p>
          )
        ) : viewChecklist.length ? (
          <ul className="strategy-checklist__list">
            {viewChecklist.map((item) => (
              <li key={item.id} className="strategy-checklist__item">
                <span className="strategy-checklist__mark" aria-hidden />
                <span className="strategy-checklist__label">{item.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-note">
            No checklist items yet. Click Edit to add them.
          </p>
        )}
      </section>
    </div>
  );
}
