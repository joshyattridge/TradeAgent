/** Resize/compress an image file to a data URL suitable for vision chat. */
export async function fileToChatImage(
  file: File,
  maxEdge = 1024,
  quality = 0.72,
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are supported");
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process image");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Compress uploaded chat images to JPEG for vision payloads
  return canvas.toDataURL("image/jpeg", quality);
}
