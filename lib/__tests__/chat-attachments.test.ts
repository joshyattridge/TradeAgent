import { describe, expect, it } from "vitest";
import {
  buildUserContentParts,
  collectConversationAttachments,
  collectConversationImages,
  mergeAttachmentPayloads,
} from "@/lib/chat-attachments";

describe("buildUserContentParts", () => {
  it("includes CSV text inline so follow-up history can replay it", () => {
    const parts = buildUserContentParts({
      text: "Are these trades correct?",
      attachments: [
        {
          kind: "text",
          name: "trading-journal-2.csv",
          text: "symbol,side\nEURUSD,long\n",
        },
      ],
    });
    expect(parts[0]?.type).toBe("text");
    if (parts[0]?.type === "text") {
      expect(parts[0].text).toContain("trading-journal-2.csv");
      expect(parts[0].text).toContain("EURUSD,long");
    }
  });

  it("keeps images and files as separate parts", () => {
    const parts = buildUserContentParts({
      text: "check this",
      images: ["data:image/png;base64,abc"],
      attachments: [
        {
          kind: "file",
          name: "note.pdf",
          mime: "application/pdf",
          dataUrl: "data:application/pdf;base64,abc",
        },
      ],
    });
    expect(parts.some((p) => p.type === "image")).toBe(true);
    expect(parts.some((p) => p.type === "file")).toBe(true);
  });
});

describe("conversation attachment persistence", () => {
  it("collects images and files from prior user turns only", () => {
    const history = [
      {
        role: "user",
        images: ["data:image/png;base64,abc"],
        attachments: [
          { kind: "text" as const, name: "a.csv", text: "row" },
        ],
      },
      { role: "assistant", content: "ok" },
      {
        role: "user",
        attachments: [
          {
            kind: "image" as const,
            name: "shot.png",
            dataUrl: "data:image/png;base64,abc",
          },
        ],
      },
    ];
    const attachments = collectConversationAttachments(history);
    expect(attachments).toHaveLength(2);
    expect(attachments.some((a) => a.kind === "text")).toBe(true);
    expect(collectConversationImages(history)).toEqual([
      "data:image/png;base64,abc",
    ]);
  });

  it("skips non-user turns, invalid images, and empty attachment slots", () => {
    const attachments = collectConversationAttachments([
      { role: "assistant", images: ["data:image/png;base64,skip"] },
      {
        role: "user",
        images: [undefined as unknown as string, "not-a-data-image"],
        attachments: [undefined as unknown as never, { kind: "text", name: "ok.csv", text: "1" }],
      },
    ]);
    expect(attachments).toEqual([{ kind: "text", name: "ok.csv", text: "1" }]);
    expect(collectConversationImages([{ role: "user" }])).toEqual([]);
  });

  it("merges payload groups without duplicates", () => {
    const merged = mergeAttachmentPayloads(
      [{ kind: "image", name: "a", dataUrl: "data:image/png;base64,x" }],
      [{ kind: "image", name: "b", dataUrl: "data:image/png;base64,x" }],
      [{ kind: "text", name: "c.csv", text: "1" }],
      undefined,
      [],
    );
    expect(merged).toHaveLength(2);
  });
});
