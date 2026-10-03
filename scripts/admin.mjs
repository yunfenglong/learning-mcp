const [command, account, grant] = process.argv.slice(2);
if (
  !["grants", "revoke"].includes(command) ||
  !/^[a-f0-9]{64}$/.test(account ?? "") ||
  (command === "revoke" && !/^(?:[a-f0-9]{64}|all)$/.test(grant ?? ""))
)
  throw new Error(
    "Usage: pnpm admin grants <account-id> | revoke <account-id> <grant-id|all>",
  );
const issuer = process.env.LEARNING_MCP_URL,
  token = process.env.LEARNING_ADMIN_TOKEN;
if (!issuer || !token)
  throw new Error(
    "Set LEARNING_MCP_URL and LEARNING_ADMIN_TOKEN in your local environment.",
  );
const url = new URL(issuer);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/"
)
  throw new Error("LEARNING_MCP_URL must be an HTTPS origin.");
const response = await fetch(new URL(`/admin/${command}`, url), {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    account_id: account,
    ...(command === "revoke" && grant !== "all" ? { grant_id: grant } : {}),
  }),
  redirect: "error",
  signal: AbortSignal.timeout(15000),
});
if (!response.ok)
  throw new Error(`Administrator request failed (HTTP ${response.status}).`);
process.stdout.write(`${JSON.stringify(await response.json(), null, 2)}\n`);
