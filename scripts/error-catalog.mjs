import { parsers } from "prettier/plugins/typescript";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const entries = new Map();
function add(code, message) {
  if (!/^[A-Z][A-Z0-9_]+$/.test(code) || !message) return;
  if (!entries.has(code)) entries.set(code, new Set());
  entries.get(code).add(message);
}
function literals(node, source = "") {
  if (!node) return [];
  if (node.type === "Literal" && typeof node.value === "string")
    return [node.value];
  if (node.type === "TemplateLiteral")
    return [
      node.quasis
        .map(
          (q, i) =>
            q.value.cooked +
            (node.expressions[i]
              ? `{${source.slice(...node.expressions[i].range)}}`
              : ""),
        )
        .join(""),
    ];
  if (node.type === "ConditionalExpression")
    return [
      ...literals(node.consequent, source),
      ...literals(node.alternate, source),
    ];
  if (node.type === "LogicalExpression" || node.type === "BinaryExpression")
    return [...literals(node.left, source), ...literals(node.right, source)];
  return [];
}
async function scan(dir) {
  for (const item of await readdir(root + dir, { withFileTypes: true })) {
    const path = `${dir}/${item.name}`;
    if (item.isDirectory()) {
      await scan(path);
      continue;
    }
    if (!item.name.endsWith(".ts")) continue;
    const source = await readFile(root + path, "utf8");
    const ast = parsers.typescript.parse(source);
    function visit(node) {
      if (!node || typeof node !== "object" || !node.type) return;
      if (node.type === "NewExpression" && node.callee.name === "SuiteError") {
        for (const code of literals(node.arguments[0], source))
          for (const message of literals(node.arguments[1], source))
            add(code, message);
      }
      if (node.type === "ObjectExpression") {
        const properties = node.properties.filter((p) => p.type === "Property");
        const property = (name) =>
          properties.find((p) => (p.key.name ?? p.key.value) === name)?.value;
        for (const code of literals(property("code"), source))
          for (const message of literals(property("message"), source))
            add(code, message);
      }
      if (
        node.type === "VariableDeclarator" &&
        node.id.name === "mfaMessages"
      ) {
        const object =
          node.init.type === "TSAsExpression"
            ? node.init.expression
            : node.init;
        if (object.type === "ObjectExpression")
          for (const p of object.properties)
            for (const message of literals(p.value, source))
              add(p.key.name, message);
      }
      for (const [key, value] of Object.entries(node)) {
        if (["loc", "range", "comments", "tokens"].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(visit);
        else visit(value);
      }
    }
    visit(ast);
  }
}
await scan("src");
await scan("broker");
const escape = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const content =
  `# Error codes and messages\n\nGenerated from suite and private broker source with \`pnpm errors:catalog\`. Browser error pages and JSON errors include the code and a sanitized message. A code can have different messages for different operations; placeholders describe context, never credentials. OAuth protocol errors from the OAuth library are separate. Unexpected exceptions remain \`INTERNAL_ERROR\` so private provider text is not exposed.\n\nFor sign-in, \`INVALID_TOTP\` checks encoding and supported parameters; it cannot prove a secret belongs to the account. \`MFA_TOTP_REJECTED\` and \`MFA_CODE_REJECTED\` mean the provider did not complete verification, not proof of which provider-side setting caused it. Interactive sign-in submits each code once, stops after 3 validation/verification errors across methods, and expires after 5 minutes. Password/SSO errors do not establish an authenticated suite session.\n\n| Code | Public messages |\n| --- | --- |\n` +
  [...entries]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([code, messages]) =>
        `| \`${code}\` | ${[...messages].map(escape).join("<br>")} |`,
    )
    .join("\n") +
  "\n";
const destination = root + "docs/error-codes.md";
if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== content)
    throw new Error("Error catalog is stale; run pnpm errors:catalog.");
} else await writeFile(destination, content);
console.log(`Error catalog: ${entries.size} codes.`);
