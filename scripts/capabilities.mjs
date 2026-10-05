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
      'export { readCapabilities, writeCapabilities, pendingWrites } from "./src/capabilities/index.ts"; export { z } from "zod";',
    resolveDir: root,
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2023",
  write: false,
});
const { readCapabilities, writeCapabilities, pendingWrites, z } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const lines = [
  "# Read and beta write capability reference",
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
  "## Beta writes",
  "",
  "These tools require `learning:write` and prepare an encrypted preview. Show the preview and obtain explicit user confirmation before `confirm_platform_write` executes it. File tools: `begin_upload`, `upload_chunk`, `finish_upload`, `cancel_upload`. Attendance submission is unavailable.",
  "",
  "| Tool | Backend operation | Arguments |",
  "| --- | --- | --- |",
);
for (const capability of writeCapabilities) {
  const schema = z.toJSONSchema(capability.input, { io: "input" });
  const required = new Set(schema.required ?? []);
  const args = Object.entries(schema.properties ?? {})
    .map(
      ([name, definition]) =>
        `\`${name}\`${required.has(name) ? "*" : ""}${definition.default === undefined ? "" : ` = ${JSON.stringify(definition.default)}`}`,
    )
    .join(", ");
  lines.push(
    `| \`${capability.name}\` | \`${capability.operation}\` | ${args} |`,
  );
}
lines.push(
  "",
  "See [beta write semantics](write-contract.md) for confirmation, uploads, expiry and uncertain outcomes.",
  "",
);
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
  console.log(
    "Capability reference matches the registered capability catalog.",
  );
} else {
  await writeFile(destination, document);
  console.log("Updated docs/capabilities.md from the capability catalog.");
}
