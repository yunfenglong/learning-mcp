import { isLearningFile } from "./files.ts";
import { CivilDate, Instant } from "../../../vendor/ontrack/client.js";
/** Official OnTrack date values have private fields and do not implement toJSON. */
export function ontrackJson(value: unknown): unknown {
  if (isLearningFile(value)) return value;
  if (value instanceof CivilDate || value instanceof Instant)
    return value.toString();
  if (Array.isArray(value)) return value.map(ontrackJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, ontrackJson(item)]),
    );
  return value;
}
