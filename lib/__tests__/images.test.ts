/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileToChatImage } from "@/lib/images";

describe("fileToChatImage", () => {
  const drawImage = vi.fn();
  const close = vi.fn();
  const toDataURL = vi.fn(() => "data:image/jpeg;base64,compressed");

  beforeEach(() => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: 800,
        height: 600,
        close,
      })),
    );

    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") {
        return document.createElement.bind(document)(tag);
      }
      return {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage })),
        toDataURL,
      } as unknown as HTMLCanvasElement;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws when the file is not an image", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await expect(fileToChatImage(file)).rejects.toThrow(
      "Only image files are supported",
    );
  });

  it("resizes without scaling when the image fits within maxEdge", async () => {
    const file = new File(["img"], "photo.jpg", { type: "image/jpeg" });
    const dataUrl = await fileToChatImage(file, 1024);

    expect(createImageBitmap).toHaveBeenCalledWith(file);
    expect(drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 800, height: 600 }),
      0,
      0,
      800,
      600,
    );
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.72);
    expect(dataUrl).toBe("data:image/jpeg;base64,compressed");
    expect(close).toHaveBeenCalled();
  });

  it("scales down when the longest edge exceeds maxEdge", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({
        width: 2048,
        height: 1024,
        close,
      })),
    );

    const file = new File(["img"], "wide.jpg", { type: "image/jpeg" });
    await fileToChatImage(file, 512);

    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      512,
      256,
    );
  });

  it("converts png and webp uploads to jpeg data URLs", async () => {
    const png = new File(["img"], "chart.png", { type: "image/png" });
    await fileToChatImage(png);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.72);

    toDataURL.mockClear();
    const webp = new File(["img"], "chart.webp", { type: "image/webp" });
    await fileToChatImage(webp);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.72);
  });

  it("throws when canvas 2d context is unavailable", async () => {
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") {
        return document.createElement.bind(document)(tag);
      }
      return {
        width: 0,
        height: 0,
        getContext: vi.fn(() => null),
        toDataURL,
      } as unknown as HTMLCanvasElement;
    });

    const file = new File(["img"], "photo.jpg", { type: "image/jpeg" });
    await expect(fileToChatImage(file)).rejects.toThrow(
      "Could not process image",
    );
  });

  it("honors custom maxEdge and quality", async () => {
    const file = new File(["img"], "photo.gif", { type: "image/gif" });
    await fileToChatImage(file, 256, 0.5);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.5);
  });
});
