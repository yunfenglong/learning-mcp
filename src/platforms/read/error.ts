import { SuiteError } from "../../errors.ts";
import type { Platform } from "../../domain/units.ts";
import { AsyncLocalStorage } from "node:async_hooks";

/** Vendor clients wrap fetch exceptions. Preserve our safe error within its own async read. */
export class PlatformReadBoundary {
  private readonly reads = new AsyncLocalStorage<{ failure?: SuiteError }>();
  constructor(private readonly platform: Platform) {}
  fetch(network: typeof fetch): typeof fetch {
    return async (input, init) => {
      try {
        return await network(input, init);
      } catch (error) {
        const read = this.reads.getStore();
        if (read && error instanceof SuiteError) read.failure = error;
        throw error;
      }
    };
  }
  run<T>(operation: () => Promise<T>): Promise<T> {
    return this.reads.run({}, async () => {
      try {
        return await operation();
      } catch (error) {
        const failure = this.reads.getStore()?.failure;
        // Ignore a failed optional fetch that the client recovered from before this failure.
        if (
          failure &&
          error instanceof Error &&
          error.message.includes(failure.message)
        )
          throw failure;
        throw platformReadError(this.platform, error);
      }
    });
  }
}

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
  if (platform === "moodle") {
    const moodle = error as {
      code?: unknown;
      name?: unknown;
      timedOut?: unknown;
      message?: unknown;
    };
    if (moodle?.code === "auth")
      return new SuiteError(
        "PLATFORM_SESSION_EXPIRED",
        "Moodle rejected the platform session. Reconnect Moodle on the account page.",
        409,
      );
    if (moodle?.name === "RequestFailed")
      return new SuiteError(
        "UPSTREAM_UNAVAILABLE",
        moodle.timedOut === true
          ? "Moodle timed out while reading the response. Retry later."
          : "Moodle could not complete the network request. Retry later.",
        502,
      );
    if (moodle?.code === "not_found")
      return new SuiteError(
        "FILE_NOT_FOUND",
        "Moodle could not find this item or file.",
        404,
      );
    if (moodle?.code === "upstream") {
      const status =
        typeof moodle.message === "string"
          ? /\bHTTP (\d{3})\b/.exec(moodle.message)?.[1]
          : undefined;
      if (status && (Number(status) === 429 || Number(status) >= 500))
        return new SuiteError(
          "UPSTREAM_UNAVAILABLE",
          `Moodle returned HTTP ${status}. Retry later.`,
          502,
        );
      return new SuiteError(
        "PLATFORM_REQUEST_REJECTED",
        status
          ? `Moodle rejected the request with HTTP ${status}.`
          : "Moodle rejected the request.",
        502,
      );
    }
  }
  if (platform === "ed") {
    const ed = error as {
      kind?: unknown;
      category?: unknown;
      status?: unknown;
      statusCode?: unknown;
    };
    const kind = ed?.kind ?? ed?.category;
    const status = typeof ed?.status === "number" ? ed.status : ed?.statusCode;
    if (kind === "auth_expired" || kind === "auth")
      return new SuiteError(
        "PLATFORM_SESSION_EXPIRED",
        "Ed rejected the platform session. Reconnect Ed on the account page.",
        409,
      );
    if (
      kind === "network" ||
      (typeof status === "number" && (status === 429 || status >= 500))
    )
      return new SuiteError(
        "UPSTREAM_UNAVAILABLE",
        "Ed could not complete the network request. Retry later.",
        502,
      );
    if (typeof status === "number" && status >= 400 && status <= 499)
      return new SuiteError(
        "PLATFORM_REQUEST_REJECTED",
        `Ed rejected the request with HTTP ${status}.`,
        502,
      );
  }
  return new SuiteError(
    "PLATFORM_UNAVAILABLE",
    `The ${platform} read failed. Check its connection.`,
    502,
  );
}
