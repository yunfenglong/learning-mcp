import { z } from "zod";
import { SuiteError } from "../src/errors.ts";

export interface TotpConfig {
  secret: string;
  algorithm: "SHA-1" | "SHA-256" | "SHA-512";
  digits: 6 | 8;
  period: number;
}

function decode(secret: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    value = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid encoding");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  if (bits && value & ((1 << bits) - 1)) throw new Error("Invalid padding");
  if (bytes.length < 10 || bytes.length > 128)
    throw new Error("Invalid length");
  return new Uint8Array(bytes);
}

export function parseTotp(input: string): TotpConfig {
  try {
    if (input.length > 2048) throw new Error("Too long");
    let secret = input,
      algorithm: TotpConfig["algorithm"] = "SHA-1";
    let digits: TotpConfig["digits"] = 6,
      period = 30;
    if (input.startsWith("otpauth://")) {
      const uri = new URL(input);
      if (uri.hostname !== "totp" || uri.username || uri.password)
        throw new Error("Invalid type");
      secret = uri.searchParams.get("secret") ?? "";
      const hash = z
        .enum(["SHA1", "SHA256", "SHA512"])
        .parse(uri.searchParams.get("algorithm") ?? "SHA1");
      algorithm =
        hash === "SHA1" ? "SHA-1" : hash === "SHA256" ? "SHA-256" : "SHA-512";
      digits = z
        .union([z.literal(6), z.literal(8)])
        .parse(Number(uri.searchParams.get("digits") ?? 6));
      period = z
        .number()
        .int()
        .min(15)
        .max(120)
        .parse(Number(uri.searchParams.get("period") ?? 30));
    }
    secret = secret.replace(/\s/g, "").toUpperCase().replace(/=+$/, "");
    decode(secret);
    return { secret, algorithm, digits, period };
  } catch {
    throw new SuiteError(
      "INVALID_TOTP",
      "Use a valid Base32 TOTP secret or otpauth://totp URI. Do not enter a current verification code.",
    );
  }
}

export async function generateTotp(
  config: TotpConfig,
  now = Date.now(),
): Promise<string> {
  const counter = BigInt(Math.floor(now / 1000 / config.period));
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, counter);
  const key = await crypto.subtle.importKey(
    "raw",
    decode(config.secret),
    { name: "HMAC", hash: config.algorithm },
    false,
    ["sign"],
  );
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  const offset = hash[hash.length - 1]! & 15;
  const value = new DataView(hash.buffer).getUint32(offset) & 0x7fffffff;
  return String(value % 10 ** config.digits).padStart(config.digits, "0");
}
