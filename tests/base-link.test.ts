import { describe, expect, it } from "vitest";
import { platformBaseLink } from "../src/platforms/base-link.ts";
describe("user-owned platform base links", () => {
  it("normalizes a public HTTPS origin without an institutional allowlist", () => {
    expect(platformBaseLink(" https://courses.school.example.edu/ ")).toBe(
      "https://courses.school.example.edu",
    );
  });
  it("rejects internal addresses and URL components that can carry secrets", () => {
    for (const value of [
      null,
      "http://courses.example.edu",
      "https://localhost",
      "https://metadata.internal",
      "https://127.0.0.1",
      "https://0x7f000001",
      "https://[::1]",
      "https://10.0.0.1",
      "https://user:pass@courses.example.edu",
      "https://courses.example.edu/path",
      "https://courses.example.edu/?token=a",
      "https://courses.example.edu/#token",
      "https://host.local/",
    ])
      expect(() => platformBaseLink(value)).toThrow();
  });
});
