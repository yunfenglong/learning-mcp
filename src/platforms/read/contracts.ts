import type { z } from "zod";
import type { edCapabilities } from "../../capabilities/ed.ts";
import type { moodleCapabilities } from "../../capabilities/moodle.ts";
import type { ontrackCapabilities } from "../../capabilities/ontrack.ts";
// Public argument types follow the capability schemas. Adapters inject only verified IDs.
type Known<T> = T extends T ? (string extends keyof T ? never : T) : never;
type Inputs<T extends readonly { input: z.ZodType }[]> = Known<
  z.infer<T[number]["input"]>
>;
type Keys<T> = T extends T ? keyof T : never;
type Merged<T> = {
  [K in Keys<T>]?: T extends T ? (K extends keyof T ? T[K] : never) : never;
};
export type EdReadArgs = Merged<Inputs<typeof edCapabilities>> & {
  courseId?: number;
  lessonId?: number;
  threadId?: number;
  slideId?: number;
  includeHtml?: boolean;
};
export type MoodleReadArgs = Omit<
  Merged<Inputs<typeof moodleCapabilities>>,
  "unit"
> & {
  unit?: number;
  courseId?: number;
  courseIds?: number[];
  includePostText?: boolean;
  sortBy?: "relevance" | "recent";
  maxForums?: number;
  maxDiscussionsPerForum?: number;
};
export type OnTrackReadArgs = Merged<Inputs<typeof ontrackCapabilities>> & {
  project_id?: number;
  unit_id?: number;
};

export type EdOperation = (typeof edCapabilities)[number]["operation"];
export type MoodleOperation = (typeof moodleCapabilities)[number]["operation"];
export type OnTrackOperation =
  (typeof ontrackCapabilities)[number]["operation"];
