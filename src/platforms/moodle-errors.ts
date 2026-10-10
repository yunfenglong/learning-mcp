import type { MoodleClientErrorAdapter } from "../../vendor/moodle/types/src/moodle-client-core.js";

// Use the bundled client's adapter seam so stale CSRF keys use its bounded,
// generation-aware reauthentication, including during parallel reads.
class MoodleApiError extends Error {
  readonly code: string;
  constructor(
    message: string,
    readonly moodleErrorCode?: string,
  ) {
    super(message);
    this.code = loginRequired(moodleErrorCode)
      ? "auth"
      : ["invalidrecord", "invalidcoursemodule"].includes(
            moodleErrorCode ?? "",
          ) || /\bHTTP 404\b/.test(message)
        ? "not_found"
        : "upstream";
  }
}
function loginRequired(code?: string) {
  return [
    "servicerequireslogin",
    "sitepolicynotagreed",
    "invalidsesskey",
  ].includes(code ?? "");
}
export const moodleErrorAdapter: MoodleClientErrorAdapter = {
  api: (message, code) => new MoodleApiError(message, code),
  notFound: (message) =>
    Object.assign(new Error(message), { code: "not_found" }),
  isApi: (error): error is MoodleApiError => error instanceof MoodleApiError,
  isLoginRequired: (error) =>
    error instanceof MoodleApiError && loginRequired(error.moodleErrorCode),
};
