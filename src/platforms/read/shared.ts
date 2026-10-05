import type { Config } from "../../config.ts";
import type { OutputBoundary } from "../../security/output.ts";
import { SuiteError } from "../../errors.ts";

export interface ReadContext<C = unknown> {
  client: C;
  config: Config;
  output: OutputBoundary;
  enrolled: (id: number) => Promise<void>;
  username?: string;
  read?: <T>(operation: () => Promise<T>) => Promise<T>;
}
export function required<T>(value: T | undefined, label: string): T {
  if (value === undefined)
    throw new SuiteError("INVALID_INPUT", `Provide ${label}.`);
  return value;
}
export function requireOwner(actual: unknown, expected: unknown) {
  if (typeof actual !== "number" || actual !== expected)
    throw new SuiteError(
      "ENTITY_NOT_ALLOWED",
      "This object does not belong to the selected course.",
      403,
    );
}
export function page<T>(
  items: T[],
  a: { limit?: number; offset?: number },
  defaultLimit = 100,
) {
  const offset = Number(a.offset ?? 0),
    limit = Number(a.limit ?? defaultLimit);
  const results = items.slice(offset, offset + limit);
  return {
    results,
    total: items.length,
    offset,
    returned: results.length,
    has_more: offset + results.length < items.length,
  };
}

export function unhandledRead(operation: never): never {
  throw new SuiteError(
    "TOOL_NOT_ALLOWED",
    `Unhandled read operation: ${operation}`,
    403,
  );
}
