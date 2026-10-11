"use client";

/**
 * Client-side image preparation.
 *
 * Full-resolution photos are wasteful to upload and often exceed a provider's
 * image limits, so large PNG/JPEG/WebP files are downscaled and re-encoded in
 * the browser before they ever reach the server. Anything that cannot be
 * decoded (or is already small enough) is passed through untouched, and the
 * server still re-validates the bytes.
 */

/** Long-edge cap; matches the ballpark limit the major vision providers use. */
export const MAX_IMAGE_DIMENSION = 1568;
/** Above this size an image is always re-encoded, even if it is not huge. */
export const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function prepareImageForUpload(file: File): Promise<File> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const needsResize = scale < 1;
    const needsReencode = file.size > MAX_IMAGE_UPLOAD_BYTES;
    if (!needsResize && !needsReencode) {
      bitmap.close?.();
      return file;
    }

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      bitmap.close?.();
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.(png|jpe?g|webp)$/i, type === "image/png" ? ".png" : ".jpg");
    return new File([blob], name, { type, lastModified: file.lastModified });
  } catch {
    // Canvas/decoder failure: upload the original and let the server decide.
    return file;
  }
}
