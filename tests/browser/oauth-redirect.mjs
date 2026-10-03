import http from "node:http";
import {
  html,
  oauthFormPolicy,
  responseSecurityHeaders,
} from "../../src/http/common.ts";

const callback = "http://127.0.0.1:18875/callback";
http
  .createServer(async (req, res) => {
    const policy = { "content-security-policy": oauthFormPolicy(callback) };
    const response =
      req.method === "POST"
        ? new Response(null, {
            status: 302,
            headers: { ...policy, location: callback },
          })
        : html(
            '<!doctype html><title>OAuth redirect regression</title><h1>OAuth redirect regression</h1><form method="post" action="/authorize"><button>Connect synthetic client</button></form>',
            200,
            policy,
          );
    const headers = responseSecurityHeaders(new Headers(response.headers));
    res.writeHead(response.status, Object.fromEntries(headers));
    res.end(await response.text());
  })
  .listen(18874, "127.0.0.1");

http
  .createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      "<!doctype html><title>Callback reached</title><h1>Callback reached</h1>",
    );
  })
  .listen(18875, "127.0.0.1");

console.log(
  "Open http://127.0.0.1:18874/authorize to check the OAuth redirect.",
);
