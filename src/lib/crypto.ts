import { createHash, randomBytes } from "node:crypto";
import { env } from "../env";

function getKey(): Buffer {
  // APP_KEY: 64 hex char (32 bytes). Jika kosong, pakai turunan JWT_SECRET (tetap jalan, tapi warning).
  const hex = env.APP_KEY;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  // fallback deterministik dari JWT_SECRET agar instan-run tetap bisa enkripsi
  const seed = env.JWT_SECRET || "rentalrdp-fallback-key-change-me-please-1234";
  return createHash("sha256").update("rdp:" + seed).digest();
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function randomPassword(len = 14): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const b = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[b[i] % chars.length];
  return out;
}

// AES-GCM encrypt -> base64(iv|cipher|tag)
export async function encryptText(plain: string): Promise<string> {
  const key = getKey();
  const iv = randomBytes(12);
  // Gunakan WebCrypto via Bun (AES-GCM)
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "encrypt",
  ]);
  const enc = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    new TextEncoder().encode(plain)
  );
  const buf = Buffer.concat([iv, Buffer.from(enc)]);
  return buf.toString("base64");
}

export async function decryptText(b64: string): Promise<string> {
  const key = getKey();
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const data = buf.subarray(12);
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "decrypt",
  ]);
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, data);
  return new TextDecoder().decode(dec);
}
