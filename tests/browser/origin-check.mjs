// Browser regression fixture: exercise native form POST using the app's headers.
// No credentials, platform calls or production services are involved.
import { createServer } from "node:http";
import { html } from "../../src/http/common.ts";

const port = 4179;
const origin = `http://localhost:${port}`;
const server = createServer(async (request, response) => {
  const submitted = request.method === "POST" && request.url === "/check";
  const valid = request.headers.origin === origin;
  const page = html(
    submitted
      ? `<h1>${valid ? "PASS: same-origin form accepted" : "FAIL: same-origin form rejected"}</h1><p>Origin: ${request.headers.origin === "null" ? "null" : valid ? "expected origin" : "missing or unexpected"}</p><a href="/">Run again</a>`
      : '<h1>Browser form origin regression</h1><p>Submit this form. The application must preserve its Origin while withholding cross-origin referrers.</p><form method="post" action="/check"><button>Check form submission</button></form>',
    submitted && !valid ? 403 : 200,
  );
  response.writeHead(page.status, Object.fromEntries(page.headers));
  response.end(await page.text());
});
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Browser regression fixture: ${origin}\n`);
});
