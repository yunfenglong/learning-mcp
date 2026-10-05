import { SuiteError } from "../../errors.ts";
import { platformFileFetch } from "../network.ts";
import { MAX_FILE_BYTES } from "./files.ts";
import { resourceOriginAllowed } from "../resource-origins.ts";

const redirects = new Set([301, 302, 303, 307, 308]);
const requestUrl = (input: RequestInfo | URL) =>
  new URL(input instanceof Request ? input.url : String(input));

export function isMoodleFileRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const url = requestUrl(input);
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  return (
    method === "GET" &&
    (/\/(?:pluginfile|webservice\/pluginfile)\.php\//.test(url.pathname) ||
      url.pathname === "/mod/resource/view.php")
  );
}

/** Only freshly owned Moodle file links reach this loop. Cookies stay on the saved Moodle origin. */
export async function fetchMoodleFile(
  site: string,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  authenticated: typeof fetch,
  network: typeof fetch,
  resourceOrigins: readonly string[],
) {
  const moodleOrigin = new URL(site).origin;
  let url = requestUrl(input);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "https:" || url.username || url.password)
      throw new SuiteError(
        "SITE_NOT_ALLOWED",
        "File transfers require a public HTTPS destination without URL credentials.",
        403,
      );
    let response: Response;
    if (url.origin === moodleOrigin) {
      if (url.pathname.startsWith("/login/") || !isMoodleFileRequest(url))
        throw new SuiteError(
          "PLATFORM_SESSION_EXPIRED",
          "Moodle redirected this file to a sign-in or non-file page. Reconnect Moodle on the account page.",
          409,
        );
      response = await authenticated(url, init);
    } else {
      if (!resourceOriginAllowed(url, resourceOrigins))
        throw new SuiteError(
          "RESOURCE_ORIGIN_NOT_ALLOWED",
          "This Moodle file destination is outside the configured RESOURCE_ORIGINS rules.",
          403,
        );
      // No Cookie, Authorization, Username, Auth-Token or other inherited platform headers.
      response = await platformFileFetch(
        url.origin,
        network,
        MAX_FILE_BYTES,
      )(url, {
        method: "GET",
        headers: { accept: "*/*" },
        signal: init?.signal,
      });
    }
    if (!redirects.has(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location)
      throw new SuiteError(
        "FILE_UNAVAILABLE",
        "The file server returned a redirect without a destination.",
        502,
      );
    if (hop >= 5)
      throw new SuiteError(
        "FILE_REDIRECT_LIMIT",
        "The file server exceeded the download redirect limit.",
        502,
      );
    url = new URL(location, url);
  }
}
