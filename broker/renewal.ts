import { parse } from "node-html-parser";
import { SuiteError } from "../src/errors.ts";
import { platformFetch } from "../src/platforms/network.ts";
import {
  cookieFetch,
  cookieHeader,
  scopedCookies,
  type SessionCookie,
} from "../src/platforms/session-cookies.ts";
import type { MoodleSession, OnTrackSession } from "../src/platforms/broker.ts";

export function moodleContext(html: string, site: string) {
  const root = parse(html);
  const cfg =
    root
      .querySelectorAll("script")
      .map((s) => s.text.match(/\bM\.cfg\s*=\s*(\{[\s\S]*?\})\s*(?:;|$)/)?.[1])
      .find(Boolean) ?? "";
  const sesskey =
    cfg.match(/["']sesskey["']\s*:\s*["']([^"']+)["']/)?.[1] ??
    root.querySelector('input[name="sesskey"]')?.getAttribute("value") ??
    html.match(/[?&]sesskey=([A-Za-z0-9]+)/)?.[1];
  const userid = Number(
    cfg.match(/["']user(?:Id|id)["']\s*:\s*["']?(\d+)/)?.[1] ??
      root.querySelector("[data-user-id]")?.getAttribute("data-user-id") ??
      root.querySelector("[data-userid]")?.getAttribute("data-userid"),
  );
  if (!sesskey || !Number.isSafeInteger(userid) || userid <= 0)
    throw new SuiteError(
      "PLATFORM_SESSION_EXPIRED",
      "Moodle did not return an authenticated account. Reconnect the platform.",
      409,
    );
  return {
    sesskey,
    user_info: {
      userid,
      siteurl: site,
      fullname:
        root.querySelector(".usertext")?.text.trim() || `Moodle user ${userid}`,
      username: "",
      firstname: "",
      lastname: "",
      email: "",
    },
  };
}

export function sessionFailure(error: unknown) {
  return (
    error instanceof SuiteError &&
    ["PLATFORM_SESSION_EXPIRED", "SESSION_INVALID"].includes(error.code)
  );
}

export async function touchMoodle(
  site: string,
  session: MoodleSession,
  network: typeof fetch,
) {
  const params = new URLSearchParams({
    sesskey: session.sesskey,
    info: "core_session_touch,core_session_time_remaining",
  });
  let response: Response;
  try {
    response = await network(`${site}/lib/ajax/service.php?${params}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { index: 0, methodname: "core_session_touch", args: {} },
        { index: 1, methodname: "core_session_time_remaining", args: {} },
      ]),
    });
  } catch (error) {
    if (error instanceof SuiteError) throw error;
    throw new SuiteError(
      "UPSTREAM_UNAVAILABLE",
      "Moodle could not renew this session. Retry later.",
      502,
    );
  }
  // Some sites disable these services. A fresh dashboard and identity probe still validate the session.
  if (response.status >= 500 || response.status === 429)
    throw new SuiteError(
      "UPSTREAM_UNAVAILABLE",
      "Moodle could not renew this session. Retry later.",
      502,
    );
  await response.body?.cancel();
}

export async function refreshOnTrack(
  site: string,
  session: OnTrackSession,
  input: SessionCookie[],
  fetchImpl: typeof fetch = globalThis.fetch,
) {
  const target = `${site}/api/auth/access-token`,
    cookies = scopedCookies(input, [site]);
  if (
    !cookies.some(
      (c) => c.name === "refresh_token" && cookieHeader([c], target),
    )
  )
    return undefined;
  const jar = cookieFetch(site, cookies, platformFetch(site, fetchImpl));
  let response: Response;
  try {
    response = await jar.fetch(target, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: '{"delete_auth_token":false}',
    });
  } catch (error) {
    if (
      error instanceof SuiteError &&
      error.code === "PLATFORM_SESSION_EXPIRED"
    )
      return undefined;
    throw new SuiteError(
      "UPSTREAM_UNAVAILABLE",
      "OnTrack could not renew this session. Retry later.",
      502,
    );
  }
  if ([401, 403, 419].includes(response.status)) {
    await response.body?.cancel();
    return undefined;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SuiteError(
      "UPSTREAM_UNAVAILABLE",
      "OnTrack could not renew this session. Retry later.",
      502,
    );
  }
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new SuiteError(
      "UPSTREAM_UNAVAILABLE",
      "OnTrack returned an invalid renewal response.",
      502,
    );
  }
  if (
    typeof data?.auth_token !== "string" ||
    !data.auth_token ||
    typeof data?.user?.username !== "string" ||
    typeof data.auth_token_expiry !== "string" ||
    !(Date.parse(data.auth_token_expiry) > Date.now())
  )
    throw new SuiteError(
      "SESSION_INVALID",
      "OnTrack did not return a valid renewed session.",
      409,
    );
  if (data.user.username !== session.profile_id)
    throw new SuiteError(
      "ACCOUNT_CHANGED",
      "Renewal returned a different account. Reconnect explicitly.",
      409,
    );
  return {
    session: {
      username: data.user.username,
      token: data.auth_token,
      expires_at: new Date(data.auth_token_expiry).toISOString(),
    },
    cookies: jar.cookies(),
  };
}
