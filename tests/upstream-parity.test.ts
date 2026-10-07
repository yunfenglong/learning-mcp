import { readCapabilities } from "../src/capabilities/index.ts";
import {
  reviewedUpstreams,
  upstreamMappings,
} from "../src/capabilities/coverage.ts";
import upstreams from "../vendor/upstreams.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";
import { edRead } from "../src/platforms/read/ed.ts";
import { moodleRead } from "../src/platforms/read/moodle.ts";
import { edWrite } from "../src/platforms/write/ed.ts";
import { moodleWrite } from "../src/platforms/write/moodle.ts";
import { ontrackWrite } from "../src/platforms/write/ontrack.ts";
import { ontrackRead } from "../src/platforms/read/ontrack.ts";
import { ontrackProfile } from "../src/platforms/broker.ts";
import { writeCapabilities } from "../src/capabilities/write/index.ts";
import { OutputBoundary } from "../src/security/output.ts";
import { unit } from "./support.ts";

function context(client: any) {
  return {
    client,
    config: { issuer: "https://suite.example", units: [unit], platforms: {} },
    output: new OutputBoundary(),
    enrolled: vi.fn(async () => {}),
    unit,
    files: [],
    username: "student",
  };
}
function moodle() {
  const entry = {
    name: "instructions.txt",
    url: "https://moodle.example.edu/pluginfile.php/20/instructions.txt",
  };
  const activity = {
    id: 10,
    name: "Task",
    modname: "resource",
    file_entries: [entry],
  };
  return {
    entry,
    activity,
    baseUrl: "https://moodle.example.edu",
    getCourses: vi.fn(async () => [{ id: 202, shortname: "Course" }]),
    getCourseContents: vi.fn(async () => [
      {
        id: 1,
        section: 0,
        name: "Introduction",
        activities: [activity, { id: 11, modname: "label", name: "Intro" }],
      },
    ]),
    getActivity: vi.fn(async () => ({
      ...activity,
      type: "resource",
      course_id: 202,
    })),
    requestAbsolute: vi.fn(async (_url: string, init?: RequestInit) =>
      new Headers(init?.headers).get("if-none-match") === '"v1"'
        ? new Response(null, { status: 304 })
        : new Response("the original bytes", {
            headers: { etag: '"v1"', "content-type": "text/plain" },
          }),
    ),
  };
}

describe("upstream parity at execution boundaries", () => {
  it("requires a new source review when pins change and maps every audited operation to a real tool", () => {
    for (const platform of ["ed", "moodle", "ontrack"] as const) {
      expect(upstreams[platform].sha).toBe(reviewedUpstreams[platform]);
      const tools = new Set(
        [...readCapabilities, ...writeCapabilities]
          .filter((c) => c.platform === platform)
          .map((c) => c.name),
      );
      for (const mapped of Object.values(upstreamMappings[platform]))
        for (const name of mapped)
          expect(tools.has(name), `${platform}: ${name}`).toBe(true);
    }
  });
  it("pages all-course Ed activity without exposing unlinked courses or losing the raw continuation", async () => {
    const c = {
      fetchUser: async () => ({ user: { id: 7 } }),
      fetchUserActivity: vi.fn(async () => [
        { value: { course_id: 101, document: "own course" } },
        { value: { course_id: 999, document: "unlinked course" } },
      ]),
    };
    const result = await edRead(
      "list_activity",
      { limit: 2, offset: 8 },
      context(c),
    );
    expect(result).toMatchObject({
      activity: [{ value: { course_id: 101 } }],
      next_offset: 10,
      filtered: 1,
    });
    expect(c.fetchUserActivity).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ courseId: undefined, offset: 8 }),
    );
  });
  it("downloads Ed attachments in pages and preserves failures without hiding the next file", async () => {
    const c = {
      fetchLesson: async () => ({
        id: 5,
        courseId: 101,
        slides: [],
        outline:
          '<file filename="one.txt" url="https://edusercontent.com/one.txt"/><file filename="two.txt" url="https://edusercontent.com/two.txt"/>',
      }),
      fetchFile: vi.fn(async () => new Response("attachment")),
    };
    const first: any = await edRead(
      "download",
      { courseId: 101, lessonId: 5, limit: 1 },
      context(c),
    );
    expect(first.files).toHaveLength(1);
    expect(first.next_offset).toBe(1);
    expect(first.manifest[0]).toMatchObject({ file_index: 0, name: "one.txt" });
  });
  it("expands lesson queries before confirmation and rejects a changed selection", async () => {
    const lesson = {
      id: 5,
      title: "Trees",
      moduleName: "Week Three",
      courseId: 101,
      slides: [{ id: 8, type: "document" }],
    };
    const completeSlide = vi.fn(async () => ({}));
    const c = {
      fetchUser: async () => ({ user: { id: 7 } }),
      fetchLessons: async () => ({ lessons: [lesson] }),
      fetchLesson: vi.fn(async () => lesson),
      fetchSlide: async () => ({ id: 8, lessonId: 5, courseId: 101 }),
      completeSlide,
    };
    const ctx = context(c);
    const args = {
      unit: unit.key,
      queries: ["week", "trees"],
      delay_seconds: 0,
    };
    const preview: any = await edWrite("mark_lessons_read", args, ctx);
    expect(preview.plan.target.lessons).toEqual([{ id: 5, title: "Trees" }]);
    expect(completeSlide).not.toHaveBeenCalled();
    lesson.title = "Changed title";
    await expect(
      edWrite(
        "mark_lessons_read",
        { ...args, all: true, queries: [] },
        { ...ctx, expectedFingerprint: preview.fingerprint },
        true,
      ),
    ).rejects.toMatchObject({ code: "WRITE_PREVIEW_CHANGED" });
    expect(completeSlide).not.toHaveBeenCalled();
  });
  it("maps inline label selection and filters forum titles before pagination", async () => {
    const c = {
      ...moodle(),
      getForums: async () => [{ id: 2, course_id: 202 }],
      getForumDiscussionRefs: async () => [
        { id: 3, subject: "General" },
        { id: 4, subject: "Assignment help" },
      ],
    };
    expect(
      await moodleRead(
        "activities",
        { unit: 202, include_labels: false },
        context(c),
      ),
    ).toMatchObject({ total: 1 });
    expect(
      await moodleRead(
        "activities",
        { unit: 202, include_labels: true, offset: 1, limit: 1 },
        context(c),
      ),
    ).toMatchObject({ total: 2, activities: [{ id: 11 }] });
    expect(
      await moodleRead(
        "forum",
        { unit: 202, forum_id: 2, query: "assignment", limit: 1 },
        context(c),
      ),
    ).toMatchObject({ total: 1, results: [{ id: 4 }] });
  });
  it("sorts Moodle forum hits across courses and allows a forum in the second linked course", async () => {
    const c = {
      ...moodle(),
      getCourses: async () => [{ id: 202 }, { id: 303 }],
      getForums: async (id: number) => [
        {
          id: id + 10,
          course_id: id,
          name: "Forum",
          course_name: "Course",
          url: "https://moodle.example.edu/mod/forum/view.php",
        },
      ],
      getForumDiscussionRefs: async (id: number) => [
        {
          id: id + 10,
          subject: "Assignment",
          group_id: 0,
          group_name: "",
          url: "https://moodle.example.edu/mod/forum/discuss.php",
        },
      ],
      getForumDiscussion: async (id: number) => ({
        id,
        course_id: id - 20,
        posts: [
          {
            id,
            parent_id: 0,
            subject: "Assignment",
            message_text: "Assignment instructions",
            message_html: "",
            time_created: id,
            is_read: true,
            author: { fullname: "Teacher" },
          },
        ],
      }),
    };
    const ctx = context(c);
    ctx.config.units.push({ ...unit, key: "second", moodle_course_id: 303 });
    const result: any = await moodleRead(
      "search_forums",
      { courseIds: [202, 303], query: "assignment", sort: "recent", limit: 1 },
      ctx,
    );
    expect(result.results[0].course_id).toBe(303);
    const selected: any = await moodleRead(
      "search_forums",
      {
        courseIds: [202, 303],
        query: "assignment",
        forum_id: 313,
        sort: "recent",
      },
      ctx,
    );
    expect(selected.results.length).toBeGreaterThan(0);
    expect(selected.results.every((r: any) => r.course_id === 303)).toBe(true);
  });
  it("shows an owned running quiz without granting sequential advancement", async () => {
    const c = {
      ...moodle(),
      getActivity: async () => ({
        id: 10,
        course_id: 202,
        type: "quiz",
        attempts: [{ id: 500 }],
      }),
      getQuizAttemptPage: vi.fn(async () => ({ page: 0 })),
    };
    await moodleRead(
      "quiz_show",
      { unit: 202, activity_id: 10, attempt_id: 500, page: 1 },
      context(c),
    );
    expect(c.getQuizAttemptPage).toHaveBeenCalledWith(500, 10, 0);
    await expect(
      moodleRead(
        "quiz_show",
        { unit: 202, activity_id: 10, attempt_id: 999 },
        context(c),
      ),
    ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
    expect(c.getQuizAttemptPage).toHaveBeenCalledTimes(1);
  });
  it("keeps quiz access passwords out of previews and only supplies them during confirmed execution", async () => {
    const c = {
      ...moodle(),
      getCourseContents: async () => [
        { activities: [{ id: 10, name: "Quiz", modname: "quiz" }] },
      ],
      getSiteInfo: async () => ({ userid: 7 }),
      getQuiz: async () => ({ attempts: [] }),
      planQuizStart: async () => ({ action: "start" }),
      startQuizAttempt: vi.fn(async (_id, options) => ({
        accepted: (await options.password()) === "quiz-access",
      })),
    };
    const ctx = context(c),
      args = { unit: unit.key, quiz_id: 10, password: "quiz-access" };
    const preview: any = await moodleWrite("quiz_start", args, ctx);
    expect(JSON.stringify(preview)).not.toContain("quiz-access");
    expect(c.startQuizAttempt).not.toHaveBeenCalled();
    await moodleWrite(
      "quiz_start",
      args,
      { ...ctx, expectedFingerprint: preview.fingerprint },
      true,
    );
    expect(c.startQuizAttempt).toHaveBeenCalledTimes(1);
    expect(ctx.output.redact("quiz-access")).toBe("[REDACTED]");
  });
  it("uses HTTP validators, restores missing local files, and protects modified files on sync", async () => {
    const c = moodle(),
      ctx = context(c);
    const first: any = await moodleRead(
      "sync",
      { unit: 202, activity_id: 10 },
      ctx,
    );
    const again: any = await moodleRead(
      "sync",
      { unit: 202, activity_id: 10, previous_manifest: first.saved_manifest },
      ctx,
    );
    expect(again.files).toEqual([]);
    expect(again.actions[0].action).toBe("unchanged");
    expect(
      new Headers(c.requestAbsolute.mock.calls.at(-1)?.[1]?.headers).get(
        "if-none-match",
      ),
    ).toBe('"v1"');
    const missing: any = await moodleRead(
      "sync",
      {
        unit: 202,
        activity_id: 10,
        previous_manifest: [{ ...first.saved_manifest[0], local_sha256: null }],
      },
      ctx,
    );
    expect(missing.files).toHaveLength(1);
    expect(missing.actions[0].action).toBe("write");
    c.requestAbsolute.mockImplementation(
      async () => new Response("updated remote bytes"),
    );
    const conflict: any = await moodleRead(
      "sync",
      {
        unit: 202,
        activity_id: 10,
        previous_manifest: [
          { ...first.saved_manifest[0], local_sha256: "f".repeat(64) },
        ],
      },
      ctx,
    );
    expect(conflict.actions[0]).toMatchObject({
      action: "conflict",
      preserve_local: true,
    });
    expect(conflict.files).toHaveLength(1);
  });
  it("does not propose deletions from an incomplete sync or overwrite locally modified removals", async () => {
    const c = moodle(),
      ctx = context(c);
    const first: any = await moodleRead("sync", { unit: 202 }, ctx);
    const previous = first.saved_manifest;
    const partial: any = await moodleRead(
      "sync",
      { unit: 202, offset: 1, previous_manifest: previous },
      ctx,
    );
    expect(partial.removals_complete).toBe(false);
    expect(partial.actions.some((v: any) => v.action === "remove")).toBe(false);
    c.getCourseContents.mockResolvedValue([
      { id: 1, section: 0, name: "Introduction", activities: [] },
    ]);
    const removed: any = await moodleRead(
      "sync",
      { unit: 202, previous_manifest: previous },
      ctx,
    );
    expect(removed.actions).toContainEqual(
      expect.objectContaining({ action: "remove" }),
    );
    const edited: any = await moodleRead(
      "sync",
      {
        unit: 202,
        previous_manifest: [{ ...previous[0], local_sha256: "f".repeat(64) }],
      },
      ctx,
    );
    expect(edited.actions).toContainEqual(
      expect.objectContaining({ action: "preserve_local" }),
    );
  });
  it("renames only the same stable source and delivers incoming bytes when a moved file was locally edited", async () => {
    const c = moodle(),
      ctx = context(c);
    const first: any = await moodleRead("sync", { unit: 202 }, ctx);
    c.getCourseContents.mockResolvedValue([
      { id: 2, section: 1, name: "New section", activities: [c.activity] },
    ]);
    const moved: any = await moodleRead(
      "sync",
      { unit: 202, previous_manifest: first.saved_manifest },
      ctx,
    );
    expect(moved.actions[0]).toMatchObject({
      action: "rename",
      from: first.saved_manifest[0].path,
    });
    expect(moved.saved_manifest[0].section_id).toBe(2);
    const edited: any = await moodleRead(
      "sync",
      {
        unit: 202,
        previous_manifest: [
          { ...first.saved_manifest[0], local_sha256: "e".repeat(64) },
        ],
      },
      ctx,
    );
    expect(edited.actions[0]).toMatchObject({
      action: "conflict",
      preserve_local: true,
    });
    expect(edited.files).toHaveLength(1);
  });
  it("counts OnTrack comment limits by Unicode code points and rejects mismatched write receipts", async () => {
    const schema = writeCapabilities.find(
      (v) => v.name === "ontrack_send_chat",
    )!.input;
    expect(
      schema.safeParse({ unit: unit.key, task: 1, message: "🙂".repeat(4095) })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ unit: unit.key, task: 1, message: "🙂".repeat(4096) })
        .success,
    ).toBe(false);
    const c = {
      getProject: async () => ({
        id: 404,
        unit: { id: 303 },
        tasks: [{ task_definition_id: 1, status: "not_started" }],
      }),
      getUnit: async () => ({
        id: 303,
        task_definitions: [
          { id: 1, abbreviation: "1", name: "Task", upload_requirements: [] },
        ],
      }),
      updateTaskState: vi.fn(async () => ({
        task_definition_id: 1,
        status: "not_started",
      })),
    };
    await expect(
      ontrackWrite(
        "set_task_state",
        { task: 1, state: "working_on_it" },
        context(c),
        true,
      ),
    ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNCERTAIN" });
    expect(c.updateTaskState).toHaveBeenCalledTimes(1);
  });
  it("refuses OnTrack writes to course definitions not assigned to the personal project", async () => {
    const c = {
      getProject: async () => ({ id: 404, unit: { id: 303 }, tasks: [] }),
      getUnit: async () => ({
        id: 303,
        task_definitions: [
          { id: 1, abbreviation: "1", name: "Task", upload_requirements: [] },
        ],
      }),
      addTaskComment: vi.fn(),
    };
    await expect(
      ontrackWrite(
        "send_chat",
        { task: 1, message: "hello" },
        context(c),
        true,
      ),
    ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
    expect(c.addTaskComment).not.toHaveBeenCalled();
  });
  it("retains only safe authenticated OnTrack profile fields and rejects an identity mismatch", async () => {
    const profile = ontrackProfile({
      id: 7,
      username: "student",
      firstName: "Test",
      email: "test@example.com",
      auth_token: "do-not-retain",
    });
    expect(profile).toMatchObject({
      first_name: "Test",
      email: "test@example.com",
    });
    expect(JSON.stringify(profile)).not.toContain("do-not-retain");
    const ctx = {
      ...context({
        getProjects: async () => [{ user_id: 7 }],
        getAuthMethod: async () => ({ method: "token" }),
      }),
      profile,
    };
    expect(await ontrackRead("get_user", {}, ctx)).toMatchObject({
      user: { id: 7, first_name: "Test" },
    });
    await expect(
      ontrackRead("get_user", {}, { ...ctx, profile: { ...profile, id: 8 } }),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
  });
});
