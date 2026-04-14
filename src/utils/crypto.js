import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

let keyBuffer;

function key() {
  if (!keyBuffer) {
    const hex = env.ENCRYPTION_KEY;
    if (hex.length === 64) {
      keyBuffer = Buffer.from(hex, "hex");
    } else {
      keyBuffer = createHash("sha256").update(hex).digest();
    }
  }
  return keyBuffer;
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns: iv:ciphertext:tag (hex encoded)
 */
export function encrypt(plaintext) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${encrypted}:${tag}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 * Input format: iv:ciphertext:tag (hex encoded)
 */
export function decrypt(encryptedStr) {
  const [ivHex, ciphertext, tagHex] = encryptedStr.split(":");

  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
