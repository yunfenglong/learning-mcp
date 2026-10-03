import { describe, expect, it } from "vitest";
import { parseTotp, generateTotp } from "../broker/totp.ts";

function base32(text: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...new TextEncoder().encode(text)]
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("");
  return (bits.match(/.{1,5}/g) ?? [])
    .map((b) => alphabet[parseInt(b.padEnd(5, "0"), 2)])
    .join("");
}
describe("TOTP", () => {
  const times = [
    59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000,
  ];
  for (const [algorithm, seed, expected] of [
    [
      "SHA1",
      "12345678901234567890",
      ["94287082", "07081804", "14050471", "89005924", "69279037", "65353130"],
    ],
    [
      "SHA256",
      "12345678901234567890123456789012",
      ["46119246", "68084774", "67062674", "91819424", "90698825", "77737706"],
    ],
    [
      "SHA512",
      "1234567890123456789012345678901234567890123456789012345678901234",
      ["90693936", "25091201", "99943326", "93441116", "38618901", "47863826"],
    ],
  ] as const) {
    it(`matches every RFC 6238 ${algorithm} test vector including times beyond 2038`, async () => {
      const config = parseTotp(
        `otpauth://totp/test?secret=${base32(seed)}&algorithm=${algorithm}&digits=8`,
      );
      for (let i = 0; i < times.length; i++)
        expect(await generateTotp(config, times[i]! * 1000)).toBe(expected[i]);
    });
  }
  it("accepts a normalized secret and honors URI parameters", async () => {
    const config = parseTotp("gezd gnbv gy3t qojq gezd gnbv gy3t qojq");
    expect(await generateTotp(config, 59000)).toBe("287082");
    const custom = parseTotp(
      `otpauth://totp/test?secret=${config.secret}&digits=8&period=60`,
    );
    expect(await generateTotp(custom, 119000)).toBe("94287082");
    expect(await generateTotp(config, 60000)).not.toBe("287082");
  });
  it("rejects current codes, HOTP, malformed secrets and unsupported parameters without echoing input", () => {
    for (const value of [
      "123456",
      "bad-secret",
      "otpauth://hotp/test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      "otpauth://totp/test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=MD5",
      "otpauth://totp/test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=7",
      "otpauth://totp/test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&period=0",
    ])
      expect(() => parseTotp(value)).toThrow(/valid Base32 TOTP secret/);
  });
});
