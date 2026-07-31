/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachmentMeta,
  buildUserContentParts,
  fileToChatAttachment,
  formatAttachedFilesPrompt,
  MAX_ATTACHMENT_BYTES,
  MAX_TEXT_CHARS,
  parseDataUrl,
  toAttachmentPayload,
  type ChatAttachment,
} from "@/lib/chat-attachments";

vi.mock("@/lib/images", () => ({
  fileToChatImage: vi.fn(async () => "data:image/jpeg;base64,compressed"),
}));

import { fileToChatImage } from "@/lib/images";

const mockFileToChatImage = vi.mocked(fileToChatImage);

describe("fileToChatAttachment", () => {
  beforeEach(() => {
    mockFileToChatImage.mockClear();
  });

  it("rejects empty files", async () => {
    const file = new File([], "empty.csv", { type: "text/csv" });
    await expect(fileToChatAttachment(file)).rejects.toThrow("empty");
  });

  it("rejects files larger than MAX_ATTACHMENT_BYTES", async () => {
    const file = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "big.csv", {
      type: "text/csv",
    });
    await expect(fileToChatAttachment(file)).rejects.toThrow("too large");
  });

  it("routes images through fileToChatImage", async () => {
    const file = new File(["img"], "chart.png", { type: "image/png" });
    const attachment = await fileToChatAttachment(file);

    expect(mockFileToChatImage).toHaveBeenCalledWith(file);
    expect(attachment).toMatchObject({
      kind: "image",
      name: "chart.png",
      mime: "image/png",
      dataUrl: "data:image/jpeg;base64,compressed",
    });
    expect(attachment.id).toBeTruthy();
  });

  it("accepts PDFs by mime type and extension", async () => {
    const byMime = new File(["pdf"], "report.pdf", {
      type: "application/pdf",
    });
    const byExt = new File(["pdf"], "report.pdf", {
      type: "application/octet-stream",
    });

    const mimeAttachment = await fileToChatAttachment(byMime);
    const extAttachment = await fileToChatAttachment(byExt);

    expect(mimeAttachment.kind).toBe("file");
    expect(mimeAttachment.mime).toBe("application/pdf");
    expect(extAttachment.kind).toBe("file");
    expect(extAttachment.mime).toBe("application/pdf");
    expect(mimeAttachment.dataUrl).toMatch(/^data:application\/pdf;base64,/);
  });

  it("rejects PDFs when FileReader returns a non-string result", async () => {
    class BrokenReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: ArrayBuffer = new ArrayBuffer(8);
      readAsDataURL() {
        queueMicrotask(() => this.onload?.());
      }
    }

    vi.stubGlobal("FileReader", BrokenReader);

    const file = new File(["pdf"], "report.pdf", { type: "application/pdf" });
    await expect(fileToChatAttachment(file)).rejects.toThrow("Could not read file");

    vi.unstubAllGlobals();
  });

  it("reads text files by mime and extension with mime fallbacks", async () => {
    const csv = new File(["a,b\n1,2"], "journal.csv", {
      type: "application/octet-stream",
    });
    const json = new File(['{"a":1}'], "data.json", { type: "application/json" });
    const md = new File(["# Title"], "notes.markdown", { type: "text/markdown" });
    const txt = new File(["hello"], "log.log", { type: "application/octet-stream" });
    const tsv = new File(["a\tb"], "sheet.tsv", { type: "application/octet-stream" });

    expect((await fileToChatAttachment(csv)).kind).toBe("text");
    expect((await fileToChatAttachment(csv)).mime).toBe("text/csv");
    expect((await fileToChatAttachment(json)).mime).toBe("application/json");
    expect((await fileToChatAttachment(md)).mime).toBe("text/markdown");
    expect((await fileToChatAttachment(txt)).mime).toBe("text/plain");
    expect((await fileToChatAttachment(tsv)).mime).toBe("text/tab-separated-values");
  });

  it("truncates long text file contents", async () => {
    const long = "x".repeat(MAX_TEXT_CHARS + 50);
    const file = new File([long], "big.txt", { type: "text/plain" });
    const attachment = await fileToChatAttachment(file);

    expect(attachment.kind).toBe("text");
    if (attachment.kind === "text") {
      expect(attachment.text.length).toBeLessThan(long.length);
      expect(attachment.text).toContain("[…truncated 50 characters]");
    }
  });

  it("treats unknown mime as UTF-8 text when bytes look textual", async () => {
    const file = new File(["plain export\nline two"], "export.bin", {
      type: "application/octet-stream",
    });
    const attachment = await fileToChatAttachment(file);

    expect(attachment.kind).toBe("text");
    if (attachment.kind === "text") {
      expect(attachment.text).toContain("plain export");
    }
  });

  it("truncates decoded unknown-mime text when it exceeds MAX_TEXT_CHARS", async () => {
    const long = "a".repeat(MAX_TEXT_CHARS + 10);
    const file = new File([long], "export.bin", {
      type: "application/octet-stream",
    });
    const attachment = await fileToChatAttachment(file);

    if (attachment.kind === "text") {
      expect(attachment.text).toContain("[…truncated 10 characters]");
    }
  });

  it("rejects binary files that do not look like text", async () => {
    const binary = new Uint8Array(100);
    binary.fill(0);
    const file = new File([binary], "archive.zip", {
      type: "application/zip",
    });

    await expect(fileToChatAttachment(file)).rejects.toThrow(
      /readable text\/PDF\/image/,
    );
  });

  it("rejects text-looking samples that contain null bytes", async () => {
    const bytes = new Uint8Array([72, 0, 105]);
    const file = new File([bytes], "broken.bin", {
      type: "application/octet-stream",
    });
    await expect(fileToChatAttachment(file)).rejects.toThrow(
      /readable text\/PDF\/image/,
    );
  });

  it("rejects PDFs when FileReader onerror fires", async () => {
    class ErrorReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      error = new DOMException("read failed");
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }

    vi.stubGlobal("FileReader", ErrorReader);

    const file = new File(["pdf"], "report.pdf", { type: "application/pdf" });
    await expect(fileToChatAttachment(file)).rejects.toThrow("read failed");

    vi.unstubAllGlobals();
  });

  it("maps octet-stream extensions through mimeFor fallbacks", async () => {
    const json = new File(['{"a":1}'], "data.json", { type: "application/octet-stream" });
    const md = new File(["# Title"], "notes.md", { type: "application/octet-stream" });
    const pdfText = new File(["%PDF"], "scan.pdf", { type: "application/octet-stream" });

    expect((await fileToChatAttachment(json)).mime).toBe("application/json");
    expect((await fileToChatAttachment(md)).mime).toBe("text/markdown");
    expect((await fileToChatAttachment(pdfText)).kind).toBe("file");
    expect((await fileToChatAttachment(pdfText)).mime).toBe("application/pdf");
  });

  it("counts ESC (0x1b) as textual in looksLikeText exports", async () => {
    const esc = new Uint8Array([72, 27, 105]);
    const file = new File([esc], "export.bin", { type: "application/octet-stream" });
    const attachment = await fileToChatAttachment(file);
    expect(attachment.kind).toBe("text");
  });

  it("rejects exports with too many control characters", async () => {
    const weird = new Uint8Array(20);
    for (let i = 0; i < weird.length; i++) weird[i] = 1;
    const file = new File([weird], "binary.bin", { type: "application/octet-stream" });
    await expect(fileToChatAttachment(file)).rejects.toThrow(/readable text\/PDF\/image/);
  });

  it("uses default names when file.name is empty", async () => {
    const image = new File(["img"], "", { type: "image/jpeg" });
    const pdf = new File(["pdf"], "", { type: "application/pdf" });
    const text = new File(["hi"], "", { type: "text/plain" });

    expect((await fileToChatAttachment(image)).name).toBe("image");
    expect((await fileToChatAttachment(pdf)).name).toBe("document.pdf");
    expect((await fileToChatAttachment(text)).name).toBe("attachment.txt");
  });
});

describe("attachmentMeta", () => {
  it("returns name, kind, and mime for each attachment shape", () => {
    const image: ChatAttachment = {
      id: "1",
      kind: "image",
      name: "chart.png",
      mime: "image/png",
      dataUrl: "data:image/png;base64,abc",
    };
    const text: ChatAttachment = {
      id: "2",
      kind: "text",
      name: "journal.csv",
      mime: "text/csv",
      text: "a,b",
    };
    const file: ChatAttachment = {
      id: "3",
      kind: "file",
      name: "note.pdf",
      mime: "application/pdf",
      dataUrl: "data:application/pdf;base64,abc",
    };

    expect(attachmentMeta(image)).toEqual({
      name: "chart.png",
      kind: "image",
      mime: "image/png",
    });
    expect(attachmentMeta(text)).toEqual({
      name: "journal.csv",
      kind: "text",
      mime: "text/csv",
    });
    expect(attachmentMeta(file)).toEqual({
      name: "note.pdf",
      kind: "file",
      mime: "application/pdf",
    });
  });
});

describe("toAttachmentPayload", () => {
  it("maps image attachments to wire payloads", () => {
    expect(
      toAttachmentPayload({
        id: "1",
        kind: "image",
        name: "chart.png",
        mime: "image/png",
        dataUrl: "data:image/png;base64,abc",
      }),
    ).toEqual({
      kind: "image",
      name: "chart.png",
      dataUrl: "data:image/png;base64,abc",
      mime: "image/png",
    });
  });

  it("maps text attachments to wire payloads", () => {
    expect(
      toAttachmentPayload({
        id: "2",
        kind: "text",
        name: "journal.csv",
        mime: "text/csv",
        text: "symbol,side",
      }),
    ).toEqual({
      kind: "text",
      name: "journal.csv",
      text: "symbol,side",
      mime: "text/csv",
    });
  });

  it("maps file attachments to wire payloads", () => {
    expect(
      toAttachmentPayload({
        id: "3",
        kind: "file",
        name: "note.pdf",
        mime: "application/pdf",
        dataUrl: "data:application/pdf;base64,abc",
      }),
    ).toEqual({
      kind: "file",
      name: "note.pdf",
      dataUrl: "data:application/pdf;base64,abc",
      mime: "application/pdf",
    });
  });
});

describe("formatAttachedFilesPrompt", () => {
  it("returns an empty string when there are no attachments", () => {
    expect(formatAttachedFilesPrompt([])).toBe("");
  });

  it("wraps each attachment in labeled blocks", () => {
    const prompt = formatAttachedFilesPrompt([
      { name: "a.csv", text: "row1" },
      { name: "b.csv", text: "row2" },
    ]);

    expect(prompt).toContain("----- Attached file: a.csv -----");
    expect(prompt).toContain("row1");
    expect(prompt).toContain("----- End of a.csv -----");
    expect(prompt).toContain("----- Attached file: b.csv -----");
    expect(prompt).toContain("row2");
    expect(prompt.split("\n\n")).toHaveLength(2);
  });
});

describe("buildUserContentParts extras", () => {
  it("skips blank image URLs and invalid file data URLs", () => {
    const parts = buildUserContentParts({
      text: "",
      images: [""],
      attachments: [
        {
          kind: "file",
          name: "broken.pdf",
          mime: "application/pdf",
          dataUrl: "not-a-data-url",
        },
        {
          kind: "text",
          name: "empty.txt",
          text: "",
        },
        {
          kind: "image",
          name: "chart.png",
          dataUrl: "data:image/png;base64,abc",
        },
      ],
      imageDetail: "low",
    });

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "(attachment)" });
    expect(parts[1]).toMatchObject({
      type: "image",
      image: "data:image/png;base64,abc",
      providerOptions: { openai: { imageDetail: "low" } },
    });
  });

  it("uses octet-stream when file and parsed mime are empty", () => {
    const parts = buildUserContentParts({
      text: "see pdf",
      attachments: [
        {
          kind: "file",
          name: "note.pdf",
          mime: "",
          dataUrl: "data:;base64,abc",
        },
      ],
    });

    const filePart = parts.find((p) => p.type === "file");
    expect(filePart).toMatchObject({
      type: "file",
      data: "abc",
      mediaType: "application/octet-stream",
      filename: "note.pdf",
    });
  });
});

describe("parseDataUrl", () => {
  it("parses a standard base64 data URL", () => {
    expect(parseDataUrl("data:image/png;base64,abc123")).toEqual({
      mime: "image/png",
      base64: "abc123",
    });
  });

  it("parses data URLs with extra parameters before base64", () => {
    expect(parseDataUrl("data:text/plain;charset=utf-8;base64,hello")).toEqual({
      mime: "text/plain",
      base64: "hello",
    });
  });

  it("defaults mime when the data URL omits it", () => {
    expect(parseDataUrl("data:;base64,abc")).toEqual({
      mime: "application/octet-stream",
      base64: "abc",
    });
  });

  it("returns null for invalid data URLs", () => {
    expect(parseDataUrl("not-a-data-url")).toBeNull();
    expect(parseDataUrl("data:image/png,notbase64")).toBeNull();
    expect(parseDataUrl("")).toBeNull();
  });
});
