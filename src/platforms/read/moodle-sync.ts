import type { SyncEntry } from "../../capabilities/moodle-sync.ts";
export type { SyncEntry } from "../../capabilities/moodle-sync.ts";

export function syncPath(...parts: string[]) {
  return parts
    .map(
      (p) =>
        p
          .replace(/[\\/\x00-\x1f<>:"|?*]/g, "_")
          .replace(/^\.+|[. ]+$/g, "")
          .slice(0, 150) || "untitled",
    )
    .join("/");
}
export function localHash(previous: SyncEntry) {
  return previous.local_sha256 === undefined
    ? previous.sha256
    : previous.local_sha256;
}
export function syncAction(entry: SyncEntry, previous?: SyncEntry) {
  if (!previous || localHash(previous) === null)
    return { action: "write", path: entry.path };
  const edited = localHash(previous) !== previous.sha256;
  if (
    edited &&
    (entry.sha256 !== previous.sha256 || entry.path !== previous.path)
  ) {
    return {
      action: "conflict",
      path: previous.path,
      incoming_path: `${entry.path}.incoming-${entry.sha256.slice(0, 12)}`,
      preserve_local: true,
    };
  }
  if (edited) return { action: "preserve_local", path: previous.path };
  if (entry.path !== previous.path && entry.sha256 === previous.sha256)
    return { action: "rename", from: previous.path, path: entry.path };
  return {
    action: entry.sha256 === previous.sha256 ? "unchanged" : "write",
    path: entry.path,
    ...(entry.path !== previous.path ? { remove_previous: previous.path } : {}),
  };
}
