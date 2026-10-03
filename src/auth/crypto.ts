import { SuiteError } from "../errors.ts";

export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function digest(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function equalSecret(
  value: string,
  expected: string,
): Promise<boolean> {
  if (!expected) return false;
  const left = await digest(value),
    right = await digest(expected);
  let difference = 0;
  for (let i = 0; i < left.length; i++)
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

export interface EncryptedRecord {
  version: 1;
  iv: string;
  ciphertext: string;
}
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

async function encryptionKey(secret: string) {
  let bytes: Uint8Array;
  try {
    bytes = decode(secret);
  } catch {
    throw new SuiteError(
      "INVALID_CONFIG",
      "The credential encryption key must be base64 encoded.",
      503,
    );
  }
  if (bytes.length !== 32)
    throw new SuiteError(
      "INVALID_CONFIG",
      "The credential encryption key must contain 32 bytes.",
      503,
    );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(
  secret: string,
  context: string,
  value: unknown,
): Promise<EncryptedRecord> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    await encryptionKey(secret),
    plain,
  );
  return {
    version: 1,
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  };
}

export async function decrypt<T>(
  secret: string,
  context: string,
  record: EncryptedRecord,
): Promise<T> {
  try {
    if (record.version !== 1) throw new Error("Unsupported record.");
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(record.iv),
        additionalData: new TextEncoder().encode(context),
      },
      await encryptionKey(secret),
      decode(record.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new SuiteError(
      "CREDENTIAL_UNAVAILABLE",
      "Reconnect this platform or check the credential encryption key.",
      503,
    );
  }
}
