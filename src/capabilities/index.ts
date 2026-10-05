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
export const pendingWrites = {
  ed: [
    "mark lessons/slides read",
    "save/amend quiz responses",
    "submit saved slide responses",
    "publish threads",
    "reply to threads/comments",
  ],
  moodle: [
    "assignment upload/replace/draft/final submit",
    "quiz start/resume/page navigation/save answers/finish",
  ],
  ontrack: [
    "read chat history (automatically marks comments read)",
    "mark chat read",
    "send chat",
    "change task state",
    "submit task files",
  ],
} as const;
const catalog: ReadCapability<undefined, "", {}> = defineRead(
  "capability_catalog",
  "List integrated reads and writes awaiting approval. Runtime/deployment operations are excluded.",
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
    writes_pending: pendingWrites,
    policy:
      "Educational platform operations are read-only. Connection/binding controls use learning:bindings.",
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
