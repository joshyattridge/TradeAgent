import { normalizeStrategyChecklist } from "./checklist";
import type { Strategy, StrategyChecklistItem } from "./types";

/** Legacy structured strategy shape (pre-markdown). */
export type LegacyStrategy = {
  name?: string;
  version?: string;
  summary?: string;
  edge?: string;
  timeframes?: { role: string; tf: string; job: string }[];
  rules?: { title: string; body: string }[];
  risk?: { title: string; body: string }[];
  targets?: { metric: string; value: string }[];
  approach?: string;
  markdown?: string;
  updatedAt?: string;
  checklist?: StrategyChecklistItem[];
};

/** Pull a display name from the first ATX heading, else fallback. */
export function strategyNameFromMarkdown(
  markdown: string,
  fallback = "Trading strategy",
): string {
  const match = markdown.match(/^\s*#\s+(.+?)\s*$/m);
  const title = match?.[1]?.replace(/[#*_`]/g, "").trim();
  return title || fallback;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * When the model mistakenly sends a short markdown snippet as a full replace,
 * fold it into the existing document instead of wiping the plan.
 * - Matching `## Heading` → replace that section in place
 * - Otherwise → append
 */
export function applyShortStrategyMarkdown(
  current: string,
  snippet: string,
): { markdown: string; mode: string } {
  const trimmed = snippet.trim();
  if (!trimmed) {
    return { markdown: current, mode: "noop" };
  }

  const h2 = trimmed.match(/^##\s+(.+?)\s*$/m);
  if (h2) {
    const title = h2[1].trim();
    const headingRe = new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`, "im");
    const match = headingRe.exec(current);
    if (match && match.index != null) {
      const start = match.index;
      const afterHeading = current.slice(start + match[0].length);
      const next = afterHeading.search(/\n##?\s+/);
      const end =
        next === -1 ? current.length : start + match[0].length + next;
      const before = current.slice(0, start).replace(/\s*$/, "\n\n");
      const after = current.slice(end).replace(/^\s*/, "\n\n");
      const markdown = `${before}${trimmed}${after}`.replace(/\n{3,}/g, "\n\n");
      return {
        markdown: `${markdown.replace(/\n+$/, "")}\n`,
        mode: `section replace (${title})`,
      };
    }
  }

  const markdown = `${current.replace(/\s*$/, "")}\n\n${trimmed}\n`;
  return { markdown, mode: "append (short markdown auto)" };
}

/** True when proposed markdown is suspiciously short vs the live strategy. */
export function isShortStrategySnippet(
  current: string,
  proposed: string,
): boolean {
  const currentLen = current.trim().length;
  const nextLen = proposed.trim().length;
  return currentLen > 200 && nextLen < Math.max(120, currentLen * 0.5);
}

/** Convert an old structured strategy into a single markdown document. */
export function legacyStrategyToMarkdown(legacy: LegacyStrategy): string {
  if (typeof legacy.markdown === "string" && legacy.markdown.trim()) {
    return legacy.markdown;
  }

  const lines: string[] = [];
  const name = legacy.name?.trim() || "Trading strategy";
  lines.push(`# ${name}`);
  if (legacy.version?.trim()) {
    lines.push(`*Version ${legacy.version.trim()}*`);
  }
  lines.push("");

  if (legacy.summary?.trim()) {
    lines.push(legacy.summary.trim(), "");
  }

  if (legacy.edge?.trim()) {
    lines.push("## Edge", "", legacy.edge.trim(), "");
  }

  if (legacy.approach?.trim()) {
    lines.push("## Approach", "", legacy.approach.trim(), "");
  }

  if (legacy.timeframes?.length) {
    lines.push("## Timeframes", "");
    for (const tf of legacy.timeframes) {
      lines.push(`- **${tf.role} (${tf.tf}):** ${tf.job}`);
    }
    lines.push("");
  }

  if (legacy.rules?.length) {
    lines.push("## Rules", "");
    for (const rule of legacy.rules) {
      lines.push(`### ${rule.title}`, "", rule.body, "");
    }
  }

  if (legacy.risk?.length) {
    lines.push("## Risk", "");
    for (const rule of legacy.risk) {
      lines.push(`### ${rule.title}`, "", rule.body, "");
    }
  }

  if (legacy.targets?.length) {
    lines.push("## Targets", "");
    for (const t of legacy.targets) {
      lines.push(`- **${t.metric}:** ${t.value}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

/**
 * Normalize any persisted / imported strategy into the markdown shape.
 * Accepts both legacy structured objects and the new markdown document.
 */
export function normalizeStrategy(raw: unknown): Strategy {
  const empty: Strategy = {
    name: "Trading strategy",
    markdown: "# Trading strategy\n\nWrite your plan here.\n",
    updatedAt: new Date().toISOString(),
    checklist: [],
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return empty;
  }

  const legacy = raw as LegacyStrategy;
  const markdown = legacyStrategyToMarkdown(legacy);
  const name =
    (typeof legacy.name === "string" && legacy.name.trim()) ||
    strategyNameFromMarkdown(markdown);
  const updatedAt =
    typeof legacy.updatedAt === "string" && legacy.updatedAt
      ? legacy.updatedAt
      : new Date().toISOString();
  const checklist = normalizeStrategyChecklist(
    (raw as { checklist?: unknown }).checklist,
  );

  return { name, markdown, updatedAt, checklist };
}

/**
 * Markdown for chat tools: keep full text, but replace huge data-URL images
 * with short placeholders so the model still sees structure + alt text.
 */
export function markdownForChat(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\((data:[^)]+)\)/gi,
    (_full, alt: string) => {
      const label = alt?.trim() || "image";
      return `![${label}]([embedded image in strategy doc])`;
    },
  );
}

/** Insert an image markdown snippet at a cursor offset. */
export function insertMarkdownImage(
  markdown: string,
  cursor: number,
  dataUrl: string,
  alt = "strategy image",
): { markdown: string; cursor: number } {
  const snippet = `![${alt}](${dataUrl})`;
  const at = Math.max(0, Math.min(cursor, markdown.length));
  const next = `${markdown.slice(0, at)}${snippet}${markdown.slice(at)}`;
  return { markdown: next, cursor: at + snippet.length };
}
