import { z } from "zod";
import { defineRead, definePlatformRead } from "./definition.ts";
import { resolveUnit } from "../domain/units.ts";

import {
  unit,
  pagination,
  moodleGradeOptions,
  moodleSearchOptions,
  section,
} from "./schemas.ts";
const id = z.number().int().positive();
const text = z.string().trim().min(1).max(200);
const activityRef = z
  .union([id, text])
  .describe("Activity ID or exact name from the linked course; no URLs.");
const batch = {
  unit,
  activity_id: activityRef.optional(),
  section: section.optional(),
  limit: z.number().int().min(1).max(50).default(20),
  offset: pagination.offset,
};

export const moodleCapabilities = [
  definePlatformRead(
    "moodle_user",
    "Read the authenticated platform identity without credentials.",
    {},
    "moodle",
    "get_user",
    "account",
  ),
  definePlatformRead(
    "moodle_courses",
    "Discover verified platform enrollments without creating course associations.",
    { ...pagination, query: text.optional() },
    "moodle",
    "courses",
    "account",
  ),
  defineRead(
    "moodle_unit",
    "Read the Moodle section index, or activities in one section, for a linked course.",
    { unit, section: section.optional() },
    "moodle",
    "unit",
    async (args, { config, adapters }) =>
      adapters.moodle.unit(resolveUnit(config.units, args.unit), args.section),
  ),
  defineRead(
    "moodle_due",
    "Read a linked course's Moodle deadlines in the next 1–365 days.",
    {
      unit: unit.optional(),
      days: z.number().int().min(1).max(365).default(14),
      ...pagination,
    },
    "moodle",
    "due",
    async (args, { config, adapters }) =>
      adapters.moodle.read(
        "due",
        args.unit ? resolveUnit(config.units, args.unit) : config.units,
        args,
      ),
  ),
  defineRead(
    "moodle_grades",
    "Read Moodle grades and feedback for a configured course.",
    { unit: unit.optional(), ...moodleGradeOptions },
    "moodle",
    "grades",
    async (args, { config, adapters }) =>
      adapters.moodle.read(
        "grades",
        args.unit ? resolveUnit(config.units, args.unit) : config.units,
        args,
      ),
  ),
  defineRead(
    "moodle_search_forums",
    "Search bounded Moodle forum text within one linked course.",
    {
      unit: unit.optional(),
      query: z.string().trim().min(1).max(200),
      ...moodleSearchOptions,
    },
    "moodle",
    "search_forums",
    async (args, { config, adapters }) =>
      adapters.moodle.read(
        "search_forums",
        args.unit ? resolveUnit(config.units, args.unit) : config.units,
        args,
      ),
  ),
  defineRead(
    "moodle_thread",
    "Read a Moodle discussion after checking the linked course and site.",
    {
      unit,
      discussion_id: id,
      limit: z.number().int().min(1).max(200).default(50),
      offset: pagination.offset,
      post_id: id.optional(),
      include_html: z.boolean().default(true),
    },
    "moodle",
    "thread",
    async (args, { config, adapters }) =>
      adapters.moodle.thread(
        resolveUnit(config.units, args.unit),
        args.discussion_id,
        args,
      ),
  ),
  definePlatformRead(
    "moodle_home",
    "Read date/timezone, current course sections, due items and unread counts for linked Moodle courses; report partial failures.",
    {
      unit: unit.optional(),
      days: z.number().int().min(1).max(365).default(14),
      limit: pagination.limit,
      alerts_limit: z.number().int().min(1).max(100).default(5),
    },
    "moodle",
    "home",
    "courses",
  ),
  definePlatformRead(
    "moodle_alerts",
    "Read notifications and message counts without marking them read.",
    { limit: pagination.limit },
    "moodle",
    "alerts",
    "account",
  ),
  definePlatformRead(
    "moodle_find",
    "Search linked course section, activity and discussion titles by words and type. No arbitrary URLs are accepted.",
    {
      unit: unit.optional(),
      query: text,
      types: z.array(text).max(20).optional(),
      ...pagination,
    },
    "moodle",
    "find",
    "courses",
  ),
  definePlatformRead(
    "moodle_item",
    "Read activity body, submission state, rubric, feedback, attachments, resources, pages, folders or quiz attempt summaries. Verify the course index before reading.",
    { unit, activity_id: activityRef },
    "moodle",
    "item",
    "course",
  ),
  definePlatformRead(
    "moodle_file",
    "Return one freshly discovered activity attachment as an embedded MCP binary resource, up to 16 MiB. The file index is zero-based.",
    {
      unit,
      activity_id: activityRef,
      file_index: z.number().int().min(0).max(10000).default(0),
    },
    "moodle",
    "file",
    "course",
  ),
  definePlatformRead(
    "moodle_download",
    "Return activity or section attachments as real MCP file resources and a manifest. Bounded to 16 MiB per batch; errors and continuation are explicit.",
    batch,
    "moodle",
    "download",
    "course",
  ),
  definePlatformRead(
    "moodle_sync",
    "Read course resources/attachments and page/book HTML with inline images. Return only files whose SHA-256 is absent from the caller's known_hashes plus a fresh manifest. No platform writes or local paths.",
    {
      ...batch,
      known_hashes: z
        .array(z.string().regex(/^[a-f0-9]{64}$/))
        .max(2000)
        .default([]),
    },
    "moodle",
    "sync",
    "course",
  ),
  definePlatformRead(
    "moodle_news",
    "Read announcement first posts for linked courses. A scan bound is reported when not all announcements were examined.",
    {
      unit: unit.optional(),
      ...pagination,
      scan_limit: z.number().int().min(1).max(100).default(100),
    },
    "moodle",
    "news",
    "courses",
  ),
  definePlatformRead(
    "moodle_forums",
    "List forums in the selected enrolled course.",
    { unit },
    "moodle",
    "forums",
    "course",
  ),
  definePlatformRead(
    "moodle_forum",
    "Page discussions in a forum verified to belong to the selected course.",
    { unit, forum_id: id, ...pagination },
    "moodle",
    "forum",
    "course",
  ),
  definePlatformRead(
    "moodle_attempt",
    "Review an existing quiz attempt listed for the authenticated user, including only answers, scores and feedback Moodle allows to be displayed. Does not start, answer or finish a quiz.",
    { unit, activity_id: activityRef, attempt_id: id },
    "moodle",
    "attempt",
    "course",
  ),
] as const;
