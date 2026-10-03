export const errorCategories = [
  "usage",
  "config",
  "auth",
  "upstream_contract",
  "upstream_api",
  "network",
  "cancellation",
  "not_found",
] as const;

export type ErrorCategory = (typeof errorCategories)[number];

export class CliError extends Error {
  readonly category: ErrorCategory;
  readonly statusCode: number | undefined;
  readonly hint: string | undefined;

  constructor(category: ErrorCategory, message: string, statusCode?: number, hint?: string) {
    super(message);
    this.name = "CliError";
    this.category = category;
    this.statusCode = statusCode;
    this.hint = hint;
  }
}

export function exitCodeFor(category: ErrorCategory): number {
  switch (category) {
    case "usage": return 2;
    case "auth": return 3;
    case "not_found": return 4;
    case "upstream_contract":
    case "upstream_api": return 5;
    case "cancellation": return 130;
    case "config":
    case "network": return 1;
  }
}
