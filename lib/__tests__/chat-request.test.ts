import { describe, expect, it } from "vitest";
import {
  sanitizeAttachment,
  sanitizeAttachments,
  sanitizeHistory,
} from "@/lib/chat-request";

describe("sanitizeAttachment", () => {
  it("rejects non-objects and unknown kinds", () => {
    expect(sanitizeAttachment(null)).toBeNull();
    expect(sanitizeAttachment("x")).toBeNull();
    expect(sanitizeAttachment({ kind: "weird" })).toBeNull();
  });

  it("sanitizes images", () => {
    expect(
      sanitizeAttachment({
        kind: "image",
        dataUrl: "not-data",
        name: "  ",
      }),
    ).toBeNull();
    expect(
      sanitizeAttachment({
        kind: "image",
        dataUrl: "data:image/png;base64,abc",
        name: "  chart.png  ",
        mime: "image/png",
      }),
    ).toEqual({
      kind: "image",
      name: "chart.png",
      dataUrl: "data:image/png;base64,abc",
      mime: "image/png",
    });
    expect(
      sanitizeAttachment({
        kind: "image",
        dataUrl: "data:image/jpeg;base64,abc",
      }),
    ).toMatchObject({ name: "attachment", mime: undefined });
  });

  it("sanitizes text with truncation", () => {
    expect(
      sanitizeAttachment({ kind: "text", text: "   ", name: "notes" }),
    ).toBeNull();
    const long = "a".repeat(120_001);
    const truncated = sanitizeAttachment({
      kind: "text",
      text: long,
      name: "big.txt",
      mime: "text/plain",
    });
    expect(truncated?.kind).toBe("text");
    if (truncated?.kind === "text") {
      expect(truncated.text).toContain("[…truncated]");
      expect(truncated.text.startsWith("a".repeat(120_000))).toBe(true);
      expect(truncated.mime).toBe("text/plain");
    }
  });

  it("sanitizes files", () => {
    expect(
      sanitizeAttachment({
        kind: "file",
        dataUrl: "http://x",
        name: "a.pdf",
      }),
    ).toBeNull();
    expect(
      sanitizeAttachment({
        kind: "file",
        dataUrl: "data:application/pdf;base64,abc",
        name: "a.pdf",
      }),
    ).toEqual({
      kind: "file",
      name: "a.pdf",
      dataUrl: "data:application/pdf;base64,abc",
      mime: "application/pdf",
    });
    expect(
      sanitizeAttachment({
        kind: "file",
        dataUrl: "data:application/pdf;base64,abc",
        name: "a.pdf",
        mime: "  application/custom  ",
      }),
    ).toMatchObject({ mime: "application/custom" });
    expect(
      sanitizeAttachment({
        kind: "file",
        dataUrl: "data:application/pdf;base64,abc",
        name: "a.pdf",
        mime: "   ",
      }),
    ).toMatchObject({ mime: "application/pdf" });
  });
});

describe("sanitizeAttachments / sanitizeHistory", () => {
  it("filters invalid attachments", () => {
    expect(sanitizeAttachments(null)).toEqual([]);
    expect(
      sanitizeAttachments([
        { kind: "image", dataUrl: "data:image/png;base64,x" },
        { kind: "nope" },
      ]),
    ).toHaveLength(1);
  });

  it("sanitizes history roles and empty messages", () => {
    expect(sanitizeHistory(null)).toEqual([]);
    expect(
      sanitizeHistory([
        null,
        { role: "system", content: "nope" },
        { role: "user", content: "   " },
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "",
          images: ["data:image/png;base64,x", "bad", 1],
        },
        {
          role: "user",
          content: "",
          attachments: [
            { kind: "text", text: "csv", name: "a.csv" },
          ],
        },
      ]),
    ).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "",
        images: ["data:image/png;base64,x"],
      },
      {
        role: "user",
        content: "",
        attachments: [{ kind: "text", name: "a.csv", text: "csv", mime: undefined }],
      },
    ]);
  });

  it("coerces non-string message content to empty string", () => {
    expect(
      sanitizeHistory([
        { role: "user", content: 123, attachments: [{ kind: "text", text: "x", name: "a.txt" }] },
      ]),
    ).toEqual([
      {
        role: "user",
        content: "",
        attachments: [{ kind: "text", name: "a.txt", text: "x", mime: undefined }],
      },
    ]);
  });
});
