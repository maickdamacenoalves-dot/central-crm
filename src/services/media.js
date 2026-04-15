import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { logger } from "../utils/logger.js";
import { prisma } from "../config/database.js";

const UPLOADS_DIR = join(process.cwd(), "uploads");
const THUMBS_DIR = join(UPLOADS_DIR, "thumbnails");

// Garante que diretórios existem
await mkdir(UPLOADS_DIR, { recursive: true });
await mkdir(THUMBS_DIR, { recursive: true });

const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "video/mp4": ".mp4",
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

// ── ClamAV Scanner ──────────────────────────────────

let clamScanner = null;
let clamAvailable = false;

async function initClamAV() {
  try {
    const NodeClam = (await import("clamscan")).default;
    clamScanner = await new NodeClam().init({
      removeInfected: false,
      quarantineInfected: false,
      debugMode: false,
      clamdscan: {
        socket: null,
        host: "127.0.0.1",
        port: 3310,
        timeout: 30000,
        active: true,
      },
      preference: "clamdscan",
    });
    clamAvailable = true;
    logger.info("ClamAV scanner initialized");
  } catch (err) {
    logger.warn({ err: err.message }, "ClamAV not available — uploads will skip virus scanning");
    clamAvailable = false;
  }
}

// Initialize ClamAV (non-blocking)
initClamAV();

/**
 * Escaneia um arquivo com ClamAV.
 * @returns {"clean"|"infected"|"skipped"}
 */
async function scanFile(filePath) {
  if (!clamAvailable || !clamScanner) {
    return "skipped";
  }

  try {
    const { isInfected, viruses } = await clamScanner.isInfected(filePath);
    if (isInfected) {
      logger.error({ filePath, viruses }, "INFECTED FILE DETECTED — deleting");
      return "infected";
    }
    return "clean";
  } catch (err) {
    logger.warn({ err: err.message, filePath }, "ClamAV scan failed, skipping");
    return "skipped";
  }
}

/**
 * Baixa mídia de uma URL (Z-API).
 */
export async function downloadMedia(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "application/octet-stream";

    return { buffer, contentType };
  } catch (err) {
    logger.error({ err, url }, "Failed to download media");
    throw err;
  }
}

/**
 * Salva buffer no disco em uploads/.
 * Retorna { filePath, fileName, fileSize }.
 */
export async function saveMedia(buffer, { mimeType, originalName }) {
  const ext = MIME_TO_EXT[mimeType] || extname(originalName || "") || ".bin";
  const fileName = `${randomUUID()}${ext}`;
  const filePath = join(UPLOADS_DIR, fileName);

  await writeFile(filePath, buffer);

  // Scan with ClamAV
  const scanResult = await scanFile(filePath);

  if (scanResult === "infected") {
    await unlink(filePath);
    logger.error({ fileName }, "Infected file deleted, aborting media save");
    throw new Error("File is infected and has been deleted");
  }

  logger.info({ fileName, size: buffer.length, virusScan: scanResult }, "Media saved to disk");

  return {
    filePath,
    fileName,
    fileSize: buffer.length,
    localUrl: `/uploads/${fileName}`,
    virusScanStatus: scanResult,
  };
}

/**
 * Gera thumbnail para imagens (200x200, JPEG).
 * Retorna o caminho do thumbnail ou null se não for imagem.
 */
export async function generateThumbnail(filePath, fileName) {
  try {
    const thumbName = `thumb_${fileName.replace(extname(fileName), ".jpg")}`;
    const thumbPath = join(THUMBS_DIR, thumbName);

    await sharp(filePath)
      .resize(200, 200, { fit: "cover" })
      .jpeg({ quality: 70 })
      .toFile(thumbPath);

    logger.info({ thumbName }, "Thumbnail generated");

    return {
      thumbPath,
      thumbUrl: `/uploads/thumbnails/${thumbName}`,
    };
  } catch (err) {
    logger.warn({ err, filePath }, "Could not generate thumbnail");
    return null;
  }
}

/**
 * Pipeline completo: download → salva → scan → thumbnail (se imagem).
 */
export async function processMediaPipeline({ mediaUrl, mimeType, fileName: originalName, mediaType }) {
  if (!mediaUrl) return null;

  try {
    const { buffer } = await downloadMedia(mediaUrl);

    const saved = await saveMedia(buffer, {
      mimeType: mimeType || "application/octet-stream",
      originalName,
    });

    let thumbnail = null;
    if (mediaType === "IMAGE") {
      thumbnail = await generateThumbnail(saved.filePath, saved.fileName);
    }

    return {
      localUrl: saved.localUrl,
      fileName: saved.fileName,
      fileSize: saved.fileSize,
      thumbnailUrl: thumbnail?.thumbUrl || null,
      virusScanStatus: saved.virusScanStatus,
    };
  } catch (err) {
    logger.error({ err, mediaUrl }, "Media pipeline failed");
    return null;
  }
}
