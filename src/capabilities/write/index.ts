import { z } from "zod";
import type { Platform } from "../../domain/units.ts";
import { edWriteCapabilities } from "./ed.ts";
import { moodleWriteCapabilities } from "./moodle.ts";
import { ontrackWriteCapabilities } from "./ontrack.ts";
export const writeCapabilities = [
  ...edWriteCapabilities,
  ...moodleWriteCapabilities,
  ...ontrackWriteCapabilities,
] as const;

const operations = (p: Platform) =>
  new Set(
    writeCapabilities.filter((c) => c.platform === p).map((c) => c.operation),
  );
export const writeOperations: Record<Platform, ReadonlySet<string>> = {
  ed: operations("ed"),
  moodle: operations("moodle"),
  ontrack: operations("ontrack"),
};
type Inputs = z.infer<(typeof writeCapabilities)[number]["input"]>;
type Keys<T> = T extends T ? keyof T : never;
export type WriteArgs = {
  [K in Keys<Inputs>]?: Inputs extends infer T
    ? T extends T
      ? K extends keyof T
        ? T[K]
        : never
      : never
    : never;
};
