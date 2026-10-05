import { SuiteError } from "../../errors.ts";
import type { Platform } from "../../domain/units.ts";

// Never forward a vendor exception or upstream error body: either can contain credentials.
export function platformReadError(
  platform: Platform,
  error: unknown,
): SuiteError {
  if (error instanceof SuiteError) return error;
  const value = error as {
    category?: unknown;
    statusCode?: unknown;
    message?: unknown;
  } | null;
  const status =
    typeof value?.statusCode === "number" &&
    Number.isInteger(value.statusCode) &&
    value.statusCode >= 400 &&
    value.statusCode <= 599
      ? value.statusCode
      : undefined;
  if (platform === "ontrack") {
    if (value?.category === "auth")
      return new SuiteError(
        "PLATFORM_SESSION_EXPIRED",
        "OnTrack rejected the platform session. Reconnect OnTrack on the account page.",
        409,
      );
    if (value?.category === "upstream_contract") {
      const fields = [
        "projects",
        "project summary",
        "project id",
        "project target_grade",
        "project portfolio_available",
        "project user_id",
        "project unit_id",
        "unit",
        "unit id",
        "unit code",
        "unit name",
        "unit my_role",
        "unit start_date",
        "unit end_date",
        "unit active",
        "unit allow_flexible_dates",
      ];
      const types = [
        "an object",
        "an array",
        "a string",
        "a number",
        "a boolean",
        "a positive safe integer",
        "a civil date",
        "an instant",
      ];
      const [field, type] =
        typeof value.message === "string"
          ? value.message.split(" must be ")
          : [];
      const detail =
        fields.includes(field ?? "") && types.includes(type ?? "")
          ? ` ${field} must be ${type}.`
          : "";
      return new SuiteError(
        "UPSTREAM_RESPONSE_INVALID",
        `OnTrack returned a response the platform client could not read.${detail}`,
        502,
      );
    }
    if (
      value?.category === "network" ||
      value?.category === "cancellation" ||
      status === 429 ||
      (status && status >= 500)
    )
      return new SuiteError(
        "UPSTREAM_UNAVAILABLE",
        status
          ? `OnTrack returned HTTP ${status}. Retry later.`
          : "OnTrack could not complete the network request. Retry later.",
        502,
      );
    if (value?.category === "upstream_api" || value?.category === "not_found")
      return new SuiteError(
        "PLATFORM_REQUEST_REJECTED",
        status
          ? `OnTrack rejected the request with HTTP ${status}.`
          : "OnTrack rejected the request.",
        502,
      );
  }
  return new SuiteError(
    "PLATFORM_UNAVAILABLE",
    `The ${platform} read failed. Check its connection.`,
    502,
  );
}
