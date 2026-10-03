import { SuiteError } from "../errors.ts";
export interface Backend {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SuiteError(
      "UPSTREAM_CONTRACT_ERROR",
      "Unexpected platform response.",
      502,
    );
  return value as Record<string, unknown>;
}
export function rows(value: unknown, key: string): Record<string, unknown>[] {
  const entries = Array.isArray(value) ? value : object(value)[key];
  if (
    entries === undefined &&
    !Array.isArray(value) &&
    object(value).total === 0
  )
    return [];
  if (!Array.isArray(entries))
    throw new SuiteError(
      "UPSTREAM_CONTRACT_ERROR",
      "Unexpected platform list.",
      502,
    );
  return entries.map(object);
}
export function plainText(value: unknown): string {
  if (typeof value === "string")
    return value
      .replace(/<\/(?:p|div|li|section)>|<br\s*\/?\s*>/gi, "\n\n")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .slice(0, 100000);
  if (Array.isArray(value)) return value.map(plainText).join("\n\n");
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return [v.text, v.content, v.children, v.message_text, v.document]
      .filter((v) => v !== undefined)
      .map(plainText)
      .join("\n\n");
  }
  return "";
}
export function timestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value))
    return new Date(value * 1000).toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value)))
    return value;
  return undefined;
}
