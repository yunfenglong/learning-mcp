import { describe, expect, it, vi } from "vitest";
import {
  cookieFetch,
  cookieHeader,
  mergeCookies,
  scopedCookies,
  type SessionCookie,
} from "../src/platforms/session-cookies.ts";
import { moodleContext, refreshOnTrack } from "../broker/renewal.ts";
const site = "https://ontrack.example.edu";
const cookies: SessionCookie[] = [
  {
    name: "username",
    value: "user",
    domain: "ontrack.example.edu",
    path: "/",
    secure: true,
  },
  {
    name: "refresh_token",
    value: "refresh-a",
    domain: "ontrack.example.edu",
    path: "/api/auth",
    secure: true,
    httpOnly: true,
  },
];
const session = { username: "user", token: "access-a", profile_id: "user" };
describe("platform session renewal", () => {
  it("does not overwrite a completed cookie rotation with a delayed concurrent response", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const initial = [
      {
        name: "session",
        value: "original",
        domain: "ontrack.example.edu",
        path: "/",
      },
    ];
    const network = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { "set-cookie": "session=current; Path=/" },
        }),
      );
    let persisted = "original";
    const jar = cookieFetch(site, initial, network, async (next, sent) => {
      if (sent.find((c) => c.name === "session")?.value !== persisted)
        return false;
      persisted = next.find((c) => c.name === "session")!.value;
      return true;
    });
    const delayed = jar.fetch(`${site}/api/projects`);
    await jar.fetch(`${site}/api/projects`);
    release(
      new Response(null, {
        headers: { "set-cookie": "session=stale; Path=/" },
      }),
    );
    await delayed;
    expect(jar.cookies()[0]?.value).toBe("current");
    expect(persisted).toBe("current");
  });
  it("exchanges the path-scoped OnTrack refresh cookie and retains token/cookie rotation", async () => {
    const expiry = new Date(Date.now() + 3600000).toISOString();
    const network = vi.fn(async (_input: any, init: any) => {
      expect(new Headers(init.headers).get("cookie")).toBe(
        "refresh_token=refresh-a; username=user",
      );
      expect(init.redirect).toBe("manual");
      expect(JSON.parse(init.body)).toEqual({ delete_auth_token: false });
      const headers = new Headers();
      headers.append(
        "set-cookie",
        "refresh_token=refresh-b; Path=/api/auth; Secure; HttpOnly; Max-Age=3600",
      );
      headers.append("set-cookie", "username=user; Path=/; Secure");
      return Response.json(
        {
          auth_token: "access-b",
          auth_token_expiry: expiry,
          user: { username: "user" },
        },
        { headers },
      );
    });
    const result = await refreshOnTrack(
      site,
      session,
      cookies,
      network as typeof fetch,
    );
    expect(result?.session).toEqual({
      username: "user",
      token: "access-b",
      expires_at: expiry,
    });
    expect(
      result?.cookies.find((c) => c.name === "refresh_token"),
    ).toMatchObject({ value: "refresh-b", httpOnly: true });
    expect(network).toHaveBeenCalledOnce();
  });
  it("rejects account changes and invalid expiry before accepting renewal", async () => {
    const network = (data: unknown) =>
      vi.fn(async () => Response.json(data)) as typeof fetch;
    await expect(
      refreshOnTrack(
        site,
        session,
        cookies,
        network({
          auth_token: "x",
          auth_token_expiry: new Date(Date.now() + 60000).toISOString(),
          user: { username: "other" },
        }),
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    await expect(
      refreshOnTrack(
        site,
        session,
        cookies,
        network({
          auth_token: "x",
          auth_token_expiry: new Date(Date.now() - 1).toISOString(),
          user: { username: "user" },
        }),
      ),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });
  it("allows browser recovery for rejected refresh cookies but keeps outages distinct", async () => {
    expect(
      await refreshOnTrack(
        site,
        session,
        cookies,
        vi.fn(async () => new Response(null, { status: 401 })) as typeof fetch,
      ),
    ).toBeUndefined();
    await expect(
      refreshOnTrack(
        site,
        session,
        cookies,
        vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    const network = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      refreshOnTrack(site, session, cookies, network as typeof fetch),
    ).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    const expired = cookies.map((c) => ({
      ...c,
      expires: Date.now() / 1000 - 1,
    }));
    expect(
      await refreshOnTrack(site, session, expired, network as typeof fetch),
    ).toBeUndefined();
    expect(network).toHaveBeenCalledOnce();
  });
  it("does not follow a refresh redirect or send credentials to a second origin", async () => {
    const network = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://foreign.example/" },
        }),
    );
    expect(
      await refreshOnTrack(site, session, cookies, network as typeof fetch),
    ).toBeUndefined();
    expect(network).toHaveBeenCalledOnce();
  });
  it("honours cookie domain, path and expiry and removes cookies on rotation/deletion", () => {
    expect(cookieHeader(cookies, `${site}/api/projects`)).toBe("username=user");
    expect(cookieHeader(cookies, `${site}/api/authentication`)).toBe(
      "username=user",
    );
    expect(cookieHeader(cookies, "https://foreign.example/api/auth")).toBe("");
    const headers = new Headers({
      "set-cookie":
        "refresh_token=deleted; Path=/api/auth; Max-Age=0; Expires=Wed, 21 Oct 2030 07:28:00 GMT, unrelated=x; Domain=foreign.example; Path=/",
    });
    const next = mergeCookies(
      cookies,
      `${site}/api/auth/access-token`,
      headers,
    );
    expect(next.map((c) => c.name)).toEqual(["username"]);
    expect(scopedCookies([{ ...cookies[0], expires: 0 }], [site])).toEqual([]);
  });
  it("reads Moodle's userId and userid variants and refuses guest pages", () => {
    for (const key of ["userId", "userid"])
      expect(
        moodleContext(
          `<script>M.cfg={"sesskey":"key","${key}":12}</script>`,
          "https://moodle.example.edu",
        ).user_info.userid,
      ).toBe(12);
    expect(
      moodleContext(
        '<input name="sesskey" value="key"><div data-user-id="12">',
        "https://moodle.example.edu",
      ).sesskey,
    ).toBe("key");
    expect(() =>
      moodleContext(
        '<script>M.cfg={"sesskey":"key","userid":0}</script>',
        "https://moodle.example.edu",
      ),
    ).toThrow();
  });
});
