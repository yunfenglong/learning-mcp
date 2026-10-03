import { z } from "zod";

export const cookieSchema = z.object({
  name: z
    .string()
    .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
    .max(100),
  value: z
    .string()
    .max(16000)
    .refine((v) => !/[\r\n;]/.test(v)),
  domain: z.string().min(1).max(253),
  path: z.string().startsWith("/").max(2048).default("/"),
  expires: z.number().finite().optional(),
  hostOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});
export const cookiesSchema = z.array(cookieSchema).max(100);
export type SessionCookie = z.infer<typeof cookieSchema>;

export function cookieMatches(cookie: SessionCookie, target: string) {
  const url = new URL(target),
    domain = cookie.domain.replace(/^\./, "").toLowerCase();
  return (
    (url.hostname === domain ||
      (!cookie.hostOnly && url.hostname.endsWith(`.${domain}`))) &&
    (!cookie.secure || url.protocol === "https:") &&
    (cookie.expires == null ||
      cookie.expires === -1 ||
      cookie.expires * 1000 > Date.now()) &&
    (url.pathname === cookie.path ||
      url.pathname.startsWith(
        cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`,
      ))
  );
}

export function cookieHeader(cookies: SessionCookie[], target: string) {
  return cookies
    .filter((c) => cookieMatches(c, target))
    .sort((a, b) => b.path.length - a.path.length)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export function scopedCookies(
  input: unknown[],
  origins: string[],
): SessionCookie[] {
  return input
    .flatMap((raw) => {
      const result = cookieSchema.safeParse(raw);
      if (!result.success) return [];
      const c = result.data;
      // Check the domain and expiry separately from path: browser restoration needs all paths.
      return origins.some((origin) =>
        cookieMatches({ ...c, path: "/" }, origin),
      )
        ? [c]
        : [];
    })
    .slice(0, 100);
}

export function mergeCookies(
  cookies: SessionCookie[],
  target: string,
  headers: Headers,
) {
  const url = new URL(target),
    next = [...cookies];
  const values =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const lines = (
    values.length ? values : [headers.get("set-cookie") ?? ""]
  ).flatMap((line) => line.split(/,(?=\s*[^;,=\s]+\s*=)/));
  for (const line of lines) {
    const [pair, ...attributes] = line.split(";");
    const split = pair?.indexOf("=") ?? -1;
    if (split < 1) continue;
    const c: SessionCookie = {
      name: pair!.slice(0, split).trim(),
      value: pair!.slice(split + 1).trim(),
      domain: url.hostname,
      hostOnly: true,
      path: url.pathname.slice(0, url.pathname.lastIndexOf("/")) || "/",
    };
    let maxAge: number | undefined;
    for (const attribute of attributes) {
      const [rawName, ...parts] = attribute.trim().split("="),
        value = parts.join("=");
      switch (rawName?.toLowerCase()) {
        case "domain":
          c.domain = value.replace(/^\./, "").toLowerCase();
          c.hostOnly = false;
          break;
        case "path":
          if (value.startsWith("/")) c.path = value;
          break;
        case "secure":
          c.secure = true;
          break;
        case "httponly":
          c.httpOnly = true;
          break;
        case "samesite": {
          const normalized =
            value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
          if (["Strict", "Lax", "None"].includes(normalized))
            c.sameSite = normalized as SessionCookie["sameSite"];
          break;
        }
        case "expires": {
          const time = Date.parse(value);
          if (Number.isFinite(time)) c.expires = time / 1000;
          break;
        }
        case "max-age":
          if (/^-?\d+$/.test(value)) maxAge = Number(value);
          break;
      }
    }
    if (maxAge != null) c.expires = Date.now() / 1000 + maxAge;
    if (
      !cookieSchema.safeParse(c).success ||
      !(
        url.hostname === c.domain ||
        (!c.hostOnly && url.hostname.endsWith(`.${c.domain}`))
      )
    )
      continue;
    const index = next.findIndex(
      (old) =>
        old.name === c.name &&
        old.domain.replace(/^\./, "") === c.domain &&
        old.path === c.path,
    );
    if (index >= 0) next.splice(index, 1);
    if (c.expires == null || c.expires * 1000 > Date.now()) next.push(c);
  }
  return next
    .filter(
      (c) =>
        c.expires == null || c.expires === -1 || c.expires * 1000 > Date.now(),
    )
    .slice(-100);
}

export function sessionCookies(
  site: string,
  session: {
    cookie_name: string;
    cookie_value: string;
    cookies?: SessionCookie[];
  },
) {
  const cookies = scopedCookies(session.cookies ?? [], [site]);
  if (!cookies.some((c) => c.name === session.cookie_name)) {
    if (cookies.length === 100) cookies.shift();
    cookies.push({
      name: session.cookie_name,
      value: session.cookie_value,
      domain: new URL(site).hostname,
      path: "/",
      hostOnly: true,
      secure: true,
    });
  }
  return cookies;
}

/** Override the upstream client's single-cookie header and retain rotations at each hop. */
export function cookieFetch(
  site: string,
  initial: SessionCookie[],
  network: typeof fetch,
  changed?: (
    cookies: SessionCookie[],
    sent: SessionCookie[],
  ) => Promise<void | boolean>,
) {
  let cookies = [...initial];
  const fetchImpl: typeof fetch = async (input, init) => {
    const target =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
    if (new URL(target).origin !== new URL(site).origin)
      throw new Error("Cookie destination is outside the configured platform.");
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const sent = [...cookies];
    headers.set("cookie", cookieHeader(sent, target));
    const response = await network(input, { ...init, headers });
    const next = mergeCookies(cookies, target, response.headers);
    if (
      JSON.stringify(next) !== JSON.stringify(cookies) &&
      (await changed?.(next, sent)) !== false
    )
      cookies = next;
    return response;
  };
  return { fetch: fetchImpl, cookies: () => cookies };
}
