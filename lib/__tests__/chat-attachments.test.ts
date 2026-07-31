import { describe, expect, it } from "vitest";
import { buildUserContentParts } from "@/lib/chat-attachments";

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
