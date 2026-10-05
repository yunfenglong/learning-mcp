import { writeCapabilities } from "./write/index.ts";
export { writeCapabilities } from "./write/index.ts";
import {
  defineRead,
  type ReadServices,
  type ReadRegistrar,
  type ReadCapability,
} from "./definition.ts";
import { edCapabilities } from "./ed.ts";
import { moodleCapabilities } from "./moodle.ts";
import { ontrackCapabilities } from "./ontrack.ts";
import { suiteCapabilities } from "./suite.ts";
import upstreams from "../../vendor/upstreams.json" with { type: "json" };
export { ED_VIEW_URI } from "./schemas.ts";
export const pendingWrites = { ed: [], moodle: [], ontrack: [] } as const;
const catalog: ReadCapability<undefined, "", {}> = defineRead(
  "capability_catalog",
  "List integrated reads and beta writes with their authorization and confirmation requirements. Runtime/deployment operations are excluded.",
  {},
  undefined,
  "",
  async () => ({
    platforms: Object.fromEntries(
      Object.entries(upstreams).map(([platform, v]) => [
        platform,
        { version: v.version, sha: v.sha },
      ]),
    ),
    read_tools: readCapabilities.map((c) => c.name),
    capabilities: readCapabilities.map(
      ({ name, platform, operation, description }) => ({
        name,
        platform,
        operation,
        description,
      }),
    ),
    write_tools: writeCapabilities.map((c) => c.name),
    writes_pending: pendingWrites,
    write_workflow: [
      "begin_upload",
      "upload_chunk",
      "finish_upload",
      "cancel_upload",
      "confirm_platform_write",
    ],
    policy:
      "Beta writes require learning:write and explicit confirmation of an account/client-bound preview. Reads use learning:read; connection/binding controls use learning:bindings. Attendance submission is prohibited.",
    file_delivery:
      "Embedded MCP binary resources; 16 MiB per file and per Moodle batch. No local paths or arbitrary URLs.",
  }),
);
export const readCapabilities = [
  ...suiteCapabilities,
  ...edCapabilities,
  ...moodleCapabilities,
  ...ontrackCapabilities,
  catalog,
] as const;
export const platformOperations: Record<
  "ed" | "moodle" | "ontrack",
  ReadonlySet<string>
> = {
  ed: new Set(edCapabilities.map((c) => c.operation)),
  moodle: new Set(moodleCapabilities.map((c) => c.operation)),
  ontrack: new Set(ontrackCapabilities.map((c) => c.operation)),
};
export function registerReadTools(
  registrar: ReadRegistrar,
  services: ReadServices,
) {
  for (const capability of readCapabilities)
    capability.register(registrar, services);
}
