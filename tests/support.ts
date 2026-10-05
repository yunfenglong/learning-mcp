import type { Store } from "../src/auth/state.ts";
import type { Unit } from "../src/domain/units.ts";
import type { Backend } from "../src/adapters/backend.ts";

export class MemoryStore implements Store {
  readonly data = new Map<string, unknown>();
  private queue = Promise.resolve();
  async get<T>(key: string) {
    return structuredClone(this.data.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    this.data.set(key, structuredClone(value));
  }
  async delete(key: string) {
    return this.data.delete(key);
  }
  async list<T>(options: { prefix?: string } = {}) {
    return new Map(
      [...this.data].filter(([key]) => key.startsWith(options.prefix ?? "")),
    ) as Map<string, T>;
  }
  async transaction<T>(callback: (store: Store) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const snapshot = structuredClone(this.data);
    try {
      return await callback(this);
    } catch (error) {
      this.data.clear();
      for (const [key, value] of snapshot) this.data.set(key, value);
      throw error;
    } finally {
      release();
    }
  }
}

export const unit: Unit = {
  key: "csc1001-my-2026-s2",
  code: "CSC1001",
  name: "Algorithms and programming",
  campus: "main",
  year: 2026,
  teaching_period: "S2",
  timezone: "UTC",
  ed_course_id: 101,
  moodle_course_id: 202,
  ontrack_unit_id: 303,
  ontrack_project_id: 404,
};
export const key = btoa("x".repeat(32));
/** A real, deterministic one-page PDF for both unit and Worker runtime extraction. */
export function taskSheetPdf() {
  const stream = "BT /F1 12 Tf 40 140 Td (Read-only task instructions) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let value = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) { offsets.push(value.length); value += `${i + 1} 0 obj\n${body}\nendobj\n`; }
  const xref = value.length;
  value += `xref\n0 6\n0000000000 65535 f \n${offsets.map(n => String(n).padStart(10, "0") + " 00000 n ").join("\n")}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(value);
}
export class FakeBackend implements Backend {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  constructor(
    private readonly responses: Record<
      string,
      unknown | ((args: Record<string, unknown>) => unknown)
    >,
  ) {}
  async call(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    if (!(name in this.responses)) throw new Error(`Unexpected call: ${name}`);
    const response = this.responses[name];
    return typeof response === "function"
      ? response(args)
      : structuredClone(response);
  }
  async close() {}
}
