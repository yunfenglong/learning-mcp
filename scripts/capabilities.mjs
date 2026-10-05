import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("wrangler/package.json"))(
  "esbuild",
);
const root = fileURLToPath(new URL("../", import.meta.url));
// Use the same compiler as the Worker; do not require an experimental Node TS loader.
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents:
      'export { readCapabilities, pendingWrites } from "./src/capabilities/index.ts"; export { z } from "zod";',
    resolveDir: root,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2023",
  write: false,
});
const { readCapabilities, pendingWrites, z } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const lines = [
  "# Read capability reference",
  "",
  "Generated from `src/capabilities/` by `pnpm capabilities:docs`. Do not edit this table by hand. Runtime/deployment management is excluded; connection and course binding controls remain in the account service.",
  "",
  "Arguments marked * are required. Defaults, validation bounds and full descriptions are available from MCP `tools/list`. Course content uses a user-confirmed course key or unambiguous code; platform IDs and arbitrary URLs cannot replace the binding.",
  "",
];
for (const platform of [undefined, "ed", "moodle", "ontrack"]) {
  lines.push(
    `## ${platform ?? "Suite"}`,
    "",
    "| Tool | Backend operation | Arguments |",
    "| --- | --- | --- |",
  );
  for (const capability of readCapabilities.filter(
    (c) => c.platform === platform,
  )) {
    const schema = z.toJSONSchema(capability.input, { io: "input" });
    const required = new Set(schema.required ?? []);
    const args = Object.entries(schema.properties ?? {})
      .map(
        ([name, definition]) =>
          `\`${name}\`${required.has(name) ? "*" : ""}${definition.default === undefined ? "" : ` = ${JSON.stringify(definition.default)}`}`,
      )
      .join(", ");
    lines.push(
      `| \`${capability.name}\` | ${capability.operation ? `\`${capability.operation}\`` : "Suite workflow"} | ${args || "None"} |`,
    );
  }
  lines.push("");
}
lines.push(
  "## Writes awaiting approval",
  "",
  "These operations are not exposed or invoked. Attendance submission remains prohibited by repository policy.",
  "",
);
for (const [platform, operations] of Object.entries(pendingWrites)) {
  lines.push(
    `### ${platform}`,
    "",
    ...operations.map((operation) => `- ${operation}`),
    "",
  );
}
lines.push(
  "See [read semantics and maintenance](read-contract.md) for scope, pagination, file delivery and side-effect boundaries.",
  "",
);
const document = lines.join("\n");
const destination = resolve(root, "docs/capabilities.md");
if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== document)
    throw new Error(
      "Capability reference is stale. Run pnpm capabilities:docs.",
    );
  console.log("Capability reference matches the registered read catalog.");
} else {
  await writeFile(destination, document);
  console.log("Updated docs/capabilities.md from the read catalog.");
}
