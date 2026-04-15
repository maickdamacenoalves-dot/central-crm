import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createReadStream, createWriteStream } from "node:fs";
import { stat, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createCipheriv, randomBytes, createHash } from "node:crypto";
import { prisma } from "../config/database.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const execAsync = promisify(exec);
const BACKUP_DIR = join(process.cwd(), "backups_tmp");
const ALGORITHM = "aes-256-cbc";

function getEncryptionKey() {
  const raw = env.ENCRYPTION_KEY;
  if (raw.length === 64) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

/**
 * Dump do PostgreSQL, compacta com gzip e criptografa com AES-256.
 */
export async function createBackup() {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dumpFile = join(BACKUP_DIR, `dump_${timestamp}.sql`);
  const gzFile = `${dumpFile}.gz`;
  const encFile = `${gzFile}.enc`;

  try {
    // 1. pg_dump
    await execAsync(`pg_dump "${env.DATABASE_URL}" -f "${dumpFile}"`);
    logger.info({ dumpFile }, "pg_dump completed");

    // 2. gzip
    await pipeline(
      createReadStream(dumpFile),
      createGzip(),
      createWriteStream(gzFile)
    );
    await unlink(dumpFile);

    // 3. Encrypt
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
    const encStream = createWriteStream(encFile);

    // Prepend IV to file
    encStream.write(iv);
    await pipeline(createReadStream(gzFile), cipher, encStream);
    await unlink(gzFile);

    const fileStat = await stat(encFile);

    logger.info({ encFile, size: fileStat.size }, "Backup encrypted");
    return { filePath: encFile, fileName: `dump_${timestamp}.sql.gz.enc`, fileSize: fileStat.size };
  } catch (err) {
    // Clean up partial files
    for (const f of [dumpFile, gzFile, encFile]) {
      try { await unlink(f); } catch { /* ignore */ }
    }
    throw err;
  }
}

/**
 * Upload para Google Drive via Service Account.
 */
export async function uploadToDrive(filePath, folderId) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || !folderId) {
    logger.warn("Google Drive not configured, skipping upload");
    return null;
  }

  try {
    const { google } = await import("googleapis");
    const { GoogleAuth } = await import("googleapis").then(m => m.default || m);

    const auth = new GoogleAuth({
      keyFile: env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    const drive = google.drive({ version: "v3", auth });

    const fileName = filePath.split(/[\\/]/).pop();

    const res = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
      },
      media: {
        mimeType: "application/octet-stream",
        body: createReadStream(filePath),
      },
      fields: "id,name,size",
    });

    logger.info({ driveFileId: res.data.id, name: res.data.name }, "Uploaded to Google Drive");
    return res.data.id;
  } catch (err) {
    logger.error({ err }, "Failed to upload to Google Drive");
    throw err;
  }
}

/**
 * Compacta pasta uploads/ e faz upload para o Drive.
 */
export async function backupMedia() {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(BACKUP_DIR, { recursive: true });

  const uploadsDir = join(process.cwd(), "uploads");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tarFile = join(BACKUP_DIR, `media_${timestamp}.tar.gz`);

  try {
    await execAsync(`tar -czf "${tarFile}" -C "${uploadsDir}" .`);

    const fileStat = await stat(tarFile);
    logger.info({ tarFile, size: fileStat.size }, "Media backup created");

    let driveFileId = null;
    if (env.GOOGLE_DRIVE_FOLDER_ID) {
      driveFileId = await uploadToDrive(tarFile, env.GOOGLE_DRIVE_FOLDER_ID);
    }

    // Clean up local tar
    await unlink(tarFile);

    return { fileName: `media_${timestamp}.tar.gz`, fileSize: fileStat.size, driveFileId };
  } catch (err) {
    try { await unlink(tarFile); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Executa backup completo (banco + mídia) ou incremental (só banco).
 */
export async function runBackup(type = "full") {
  const backup = await prisma.backup.create({
    data: {
      fileName: `backup_${type}_pending`,
      type,
      status: "running",
    },
  });

  try {
    // Database backup
    const dbBackup = await createBackup();

    let driveFileId = null;
    if (env.GOOGLE_DRIVE_FOLDER_ID) {
      driveFileId = await uploadToDrive(dbBackup.filePath, env.GOOGLE_DRIVE_FOLDER_ID);
    }

    // Clean up local encrypted dump
    try { await unlink(dbBackup.filePath); } catch { /* ignore */ }

    // Media backup (full only)
    let mediaResult = null;
    if (type === "full") {
      try {
        mediaResult = await backupMedia();
      } catch (err) {
        logger.error({ err }, "Media backup failed, continuing with db-only");
      }
    }

    const totalSize = BigInt(dbBackup.fileSize) + BigInt(mediaResult?.fileSize || 0);

    await prisma.backup.update({
      where: { id: backup.id },
      data: {
        fileName: dbBackup.fileName,
        fileSize: totalSize,
        status: "completed",
        driveFileId: driveFileId || mediaResult?.driveFileId || null,
        finishedAt: new Date(),
      },
    });

    logger.info({ backupId: backup.id, type, size: totalSize.toString() }, "Backup completed");
    return backup.id;
  } catch (err) {
    await prisma.backup.update({
      where: { id: backup.id },
      data: {
        status: "failed",
        errorMessage: err.message,
        finishedAt: new Date(),
      },
    });

    logger.error({ err, backupId: backup.id }, "Backup failed");
    throw err;
  }
}
