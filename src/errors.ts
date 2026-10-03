export class SuiteError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "SuiteError";
  }
}

export function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof SuiteError)
    return { code: error.code, message: error.message };
  return {
    code: "INTERNAL_ERROR",
    message: "The request could not be completed.",
  };
}
