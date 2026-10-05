import { CivilDate, Instant } from "../vendor/ontrack/client.js";
import { ontrackJson } from "../src/platforms/read/ontrack-json.ts";
import { describe, expect, it, vi } from "vitest";
import { EdClient } from "../vendor/ed/client.js";
import { edRead } from "../src/platforms/read/ed.ts";
import { moodleRead } from "../src/platforms/read/moodle.ts";
import { ontrackRead } from "../src/platforms/read/ontrack.ts";
import { platformOperations } from "../src/capabilities/index.ts";
import {
  learningFile,
  fileContents,
  responseBytes,
  MAX_FILE_BYTES,
} from "../src/platforms/read/files.ts";
import { OutputBoundary } from "../src/security/output.ts";
import { DirectBackend } from "../src/platforms/direct.ts";
import type { ReadContext } from "../src/platforms/read/shared.ts";
import { unit, taskSheetPdf } from "./support.ts";

const context = (client: any): ReadContext<any> => ({
  client,
  config: { issuer: "https://suite.example", units: [unit], platforms: {} },
  output: new OutputBoundary(),
  enrolled: vi.fn(async () => {}),
  username: "student",
});
const courses = [
  { id: 202, shortname: "CSC1001", fullname: "Algorithms", visible: true },
];
const activities = [
  {
    id: 10,
    name: "Assignment 1",
    modname: "assign",
    description: "Full assignment body",
    file_entries: [],
  },
  { id: 20, name: "Quiz 1", modname: "quiz", file_entries: [] },
  { id: 30, name: "Lecture file", modname: "resource", file_entries: [] },
  { id: 40, name: "Reading", modname: "page", file_entries: [] },
];
const moodle = () => ({
  baseUrl: "https://moodle.example.edu",
  getCourses: vi.fn(async () => courses),
  getCourseContents: vi.fn(async () => [
    {
      id: 1,
      section: 0,
      name: "Week 1",
      summary: "",
      visible: true,
      activities,
    },
  ]),
  getActivity: vi.fn(async (id: number) => ({
    ...activities.find((v) => v.id === id),
    type: activities.find((v) => v.id === id)?.modname,
    course_id: 202,
    file_entries:
      id === 30
        ? [0, 1, 2].map((index) => ({
            name: `file-${index}.txt`,
            url: `https://moodle.example.edu/pluginfile.php/202/file-${index}.txt`,
          }))
        : [],
    attempts: id === 20 ? [{ id: 500 }] : [],
  })),
  getForumDiscussion: vi.fn(async (id: number) => ({
    id,
    course_id: 202,
    subject: "Discussion",
    posts: Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      message_text: `Post ${i + 1}`,
      time_created: i,
    })),
  })),
  getForums: vi.fn(async () => [{ id: 55, course_id: 202 }]),
  getQuizAttempt: vi.fn(async (id: number) => ({
    id,
    course_id: 202,
    quiz_id: 222,
    questions: [{ text: "Allowed review", response: "My answer" }],
  })),
  requestAbsolute: vi.fn(
    async (url: string) =>
      new Response(new URL(url).pathname, {
        headers: { "content-type": "text/plain" },
      }),
  ),
});

describe("Ed read coverage and boundaries", () => {
  it("applies course ownership checks inside upstream interactive builders", async () => {
    for (const operation of [
      "show_thread_activity",
      "show_forum_catchup",
      "show_lesson_progress",
    ] as const) {
      const client = {
        fetchUser: async () => ({
          courses: [{ id: 101, code: "CSC1001", name: "Algorithms" }],
        }),
        fetchThreads: async () => [{ courseId: 999 }],
        fetchLessons: async () => ({
          modules: [{ id: 4, courseId: 999 }],
          lessons: [],
        }),
      };
      await expect(
        edRead(
          operation,
          { courseId: 101, weeks: 12, days: 14 },
          context(client),
        ),
      ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
    }
  });
  it("rejects foreign lesson and module rows in module listings", async () => {
    for (const foreign of ["modules", "lessons"]) {
      const client = {
        fetchLessons: async () => ({
          modules: [{ id: 4, courseId: foreign === "modules" ? 999 : 101 }],
          lessons: [
            { id: 5, moduleId: 4, courseId: foreign === "lessons" ? 999 : 101 },
          ],
        }),
      };
      await expect(
        edRead("list_modules", { courseId: 101 }, context(client)),
      ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
    }
  });
  it("passes paging/sort, filters bodies and returns truthful search coverage", async () => {
    const network = vi.fn(async (input: any) => {
      const url = new URL(input);
      if (url.pathname === "/api/user")
        return Response.json({
          user: { id: 7 },
          courses: [{ course: { id: 101 } }],
        });
      if (url.pathname.includes("/threads"))
        return Response.json({
          threads: [
            {
              id: 1,
              course_id: 101,
              title: "Question",
              document: "Attendance information",
              is_answered: false,
            },
            {
              id: 2,
              course_id: 101,
              title: "Other",
              document: "No match",
              is_answered: true,
            },
          ],
        });
      throw new Error(`Unexpected ${url.pathname}`);
    });
    const result: any = await edRead(
      "search_threads",
      {
        courseId: 101,
        query: "attendance",
        answered: false,
        offset: 15,
        limit: 10,
        sort: "old",
      },
      context(new EdClient({ token: "test", fetch: network })),
    );
    expect(result.threads.map((v: any) => v.id)).toEqual([1]);
    expect(result.coverage).toBe("bounded");
    const url = new URL(
      network.mock.calls.find(([input]) =>
        new URL(input).pathname.includes("/threads"),
      )![0],
    );
    expect(url.searchParams.get("offset")).toBe("15");
    expect(url.searchParams.get("sort")).toBe("old");
  });
  it("checks a slide's lesson before asking for saved quiz responses", async () => {
    const c = {
      fetchLesson: vi.fn(async () => ({
        id: 5,
        courseId: 101,
        slides: [{ id: 8 }],
      })),
      fetchSlideQuestionResponses: vi.fn(),
      fetchSlide: vi.fn(),
    };
    await expect(
      edRead(
        "list_slide_responses",
        { courseId: 101, lessonId: 5, slideId: 9 },
        context(c),
      ),
    ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
    expect(c.fetchSlideQuestionResponses).not.toHaveBeenCalled();
    expect(c.fetchSlide).not.toHaveBeenCalled();
  });
  it("reads slides with view=false and returns only the current user's saved responses", async () => {
    const c = {
      fetchLesson: vi.fn(async () => ({
        id: 5,
        courseId: 101,
        slides: [{ id: 8 }],
      })),
      fetchSlide: vi.fn(async () => ({ id: 8, lessonId: 5, courseId: 101 })),
      fetchUser: vi.fn(async () => ({ user: { id: 7 } })),
      fetchSlideQuestionResponses: vi.fn(async () => [
        { userId: 7, data: [1] },
        { userId: 99, data: [2] },
      ]),
    };
    expect(
      await edRead(
        "list_slide_responses",
        { courseId: 101, lessonId: 5, slideId: 8 },
        context(c),
      ),
    ).toEqual({ responses: [{ userId: 7, data: [1] }] });
    expect(c.fetchSlide).toHaveBeenCalledWith(8, { view: false });
    expect(c.fetchLesson).toHaveBeenCalledWith(5, { view: false });
  });
  it("rejects foreign threads before listing or downloading their attachments", async () => {
    const c = {
      fetchThread: vi.fn(async () => ({ courseId: 999 })),
      fetchFile: vi.fn(),
    };
    await expect(
      edRead("file", { courseId: 101, threadId: 7 }, context(c)),
    ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
    expect(c.fetchFile).not.toHaveBeenCalled();
  });
});

describe("Moodle forum ownership", () => {
  it("rejects a foreign forum returned by the course endpoint", async () => {
    const c = moodle();
    c.getForums.mockResolvedValue([{ id: 55, course_id: 999 }]);
    await expect(
      moodleRead("forums", { courseId: 202 }, context(c) as any),
    ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
  });
  it("checks forum ownership before following title-search or news references", async () => {
    for (const operation of ["find", "news"] as const) {
      const references = vi.fn(async () => []);
      const client = {
        ...moodle(),
        getForums: async () => [{ id: 55, course_id: 999 }],
        getNewsForums: async () => [{ id: 55, course_id: 999 }],
        getForumDiscussionRefs: references,
      };
      await expect(
        moodleRead(
          operation,
          { courseId: 202, query: "announcement" },
          context(client) as any,
        ),
      ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
      expect(references).not.toHaveBeenCalled();
    }
  });
});

describe("Moodle read coverage and ownership", () => {
  it("continues deadline pages beyond the first upstream limit", async () => {
    const c = {
      ...moodle(),
      getTodo: vi.fn(async (limit: number) =>
        Array.from({ length: limit }, (_, i) => ({
          id: i + 1,
          course_id: 202,
          due_at: i,
        })),
      ),
    };
    const result = await moodleRead(
      "due",
      { unit: 202, limit: 2, offset: 4 },
      context(c),
    );
    expect(result).toMatchObject({
      due: [{ id: 5 }, { id: 6 }],
      has_more: true,
    });
    expect(c.getTodo).toHaveBeenCalledWith(7, 14, 202);
  });
  it("can retrieve the second discussion page rather than repeating the first", async () => {
    const result: any = await moodleRead(
      "thread",
      { unit: 202, discussion_id: 4, limit: 20, offset: 20 },
      context(moodle()),
    );
    expect(result.thread.posts.map((v: any) => v.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 21),
    );
    expect(result.thread.posts_total).toBe(60);
    expect(result.thread.has_more).toBe(true);
  });
  it("resolves section names including section zero", async () => {
    const c = moodle();
    expect(
      (
        (await moodleRead(
          "unit",
          { unit: 202, section: "Week 1" },
          context(c),
        )) as any
      ).sections,
    ).toHaveLength(1);
    expect(
      ((await moodleRead("unit", { unit: 202, section: 0 }, context(c))) as any)
        .sections,
    ).toHaveLength(1);
  });
  it("keeps assignment body, rubric and files but refuses unowned activities", async () => {
    const c = moodle();
    expect(
      (
        (await moodleRead(
          "item",
          { unit: 202, activity_id: "Assignment 1" },
          context(c),
        )) as any
      ).item.description,
    ).toBe("Full assignment body");
    await expect(
      moodleRead("item", { unit: 202, activity_id: 999 }, context(c)),
    ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
    expect(c.getActivity).toHaveBeenCalledTimes(1);
  });
  it("verifies the user's listed quiz attempts before loading a review", async () => {
    const c = moodle();
    await expect(
      moodleRead(
        "attempt",
        { unit: 202, activity_id: 20, attempt_id: 501 },
        context(c),
      ),
    ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
    expect(c.getQuizAttempt).not.toHaveBeenCalled();
    expect(
      (
        (await moodleRead(
          "attempt",
          { unit: 202, activity_id: 20, attempt_id: 500 },
          context(c),
        )) as any
      ).attempt.questions[0].response,
    ).toBe("My answer");
  });
  it("passes forum filters and scan budgets to upstream search", async () => {
    const c = { ...moodle(), searchForumContent: vi.fn(async () => []) };
    await moodleRead(
      "search_forums",
      {
        unit: 202,
        query: "topic",
        forum_id: 55,
        titles_only: true,
        unread_only: true,
        sort: "relevance",
        include_post_text: false,
        limit: 12,
        max_forums: 3,
        max_discussions_per_forum: 7,
      },
      context(c),
    );
    expect(c.searchForumContent).toHaveBeenCalledWith(
      expect.objectContaining({
        forumCmid: 55,
        titlesOnly: true,
        unreadOnly: true,
        sortBy: "relevance",
        includePostText: false,
        limit: 13,
        maxForums: 3,
        maxDiscussionsPerForum: 7,
      }),
    );
  });
  it("filters, counts and pages grades across linked courses without feedback unless requested", async () => {
    const c = {
      ...moodle(),
      getCourseGrades: vi.fn(async () => ({
        course_id: 202,
        items: [
          { name: "A", modname: "assign", grade: "80", feedback: "Nice" },
          { name: "B", modname: "quiz", grade: "-", feedback: "" },
          { name: "C", modname: "assign", grade: "90", feedback: "Good" },
        ],
      })),
    };
    const result: any = await moodleRead(
      "grades",
      {
        courseIds: [202],
        mode: "graded",
        types: ["assign"],
        include_feedback: false,
        limit: 1,
        offset: 1,
      },
      context(c),
    );
    expect(result.grades[0].items).toEqual([
      { name: "C", modname: "assign", grade: "90", feedback: undefined },
    ]);
    expect(result.matched).toBe(2);
    expect(result.has_more).toBe(false);
  });
  it("does not fetch caller URLs or foreign file origins", async () => {
    const c = moodle();
    c.getActivity.mockResolvedValueOnce({
      id: 30,
      course_id: 202,
      file_entries: [{ name: "bad", url: "https://evil.example/credential" }],
    } as any);
    await expect(
      moodleRead("file", { unit: 202, activity_id: 30 }, context(c)),
    ).rejects.toMatchObject({ code: "SITE_NOT_ALLOWED" });
    expect(c.requestAbsolute).not.toHaveBeenCalled();
  });
  it("paginates batches and omits unchanged bytes using fresh SHA-256", async () => {
    const c = moodle(),
      ctx = context(c);
    const first: any = await moodleRead(
      "sync",
      { unit: 202, activity_id: 30, limit: 1, offset: 0 },
      ctx,
    );
    expect(first.files).toHaveLength(1);
    expect(first.next_offset).toBe(1);
    const second: any = await moodleRead(
      "sync",
      { unit: 202, activity_id: 30, limit: 1, offset: 1 },
      ctx,
    );
    expect(second.manifest[0].source).toBe("activity:30:file:1");
    const unchanged: any = await moodleRead(
      "sync",
      {
        unit: 202,
        activity_id: 30,
        limit: 1,
        known_hashes: [first.manifest[0].sha256],
      },
      ctx,
    );
    expect(unchanged.files).toEqual([]);
    expect(unchanged.unchanged).toBe(1);
  });
  it("saves safe page HTML with authenticated images inline and no session fields", async () => {
    const c = moodle(),
      ctx = context(c);
    ctx.output.remember("session-secret");
    c.requestAbsolute.mockImplementation(async (url: string) =>
      url.includes("pluginfile")
        ? new Response("image", { headers: { "content-type": "image/png" } })
        : new Response(
            '<div role="main"><p>Read me</p><img src="/pluginfile.php/202/img.png"><script>bad()</script><a href="https://moodle.example.edu/a?sesskey=session-secret">link</a></div>',
            { headers: { "content-type": "text/html" } },
          ),
    );
    const result: any = await moodleRead(
      "sync",
      { unit: 202, activity_id: 40 },
      ctx,
    );
    const html = atob(result.files[0].blob);
    expect(html).toContain("data:image/png;base64");
    expect(html).toContain("Read me");
    expect(html).not.toContain("session-secret");
    expect(html).not.toContain("<script>");
  });
});

const ontrack = () => ({
  getProject: vi.fn(async () => ({
    id: 404,
    unit: { id: 303 },
    flexible_dates: false,
    special_consideration_days: 2,
    tasks: [
      {
        task_definition_id: 1,
        due_date: CivilDate.parse("2020-01-01"),
        grade: null,
        status: "working_on_it",
        num_new_comments: 3,
      },
    ],
  })),
  getUnit: vi.fn(async () => ({
    id: 303,
    task_definitions: [
      { id: 1, abbreviation: "1.1", name: "Task one" },
      { id: 2, abbreviation: "2.1", name: "Task two" },
    ],
  })),
});
describe("OnTrack read scope", () => {
  it("extracts real task PDF text without invoking an external CLI", async () => {
    const c = {
      ...ontrack(),
      downloadTaskSheet: vi.fn(async () => ({ bytes: taskSheetPdf() })),
    };
    const result: any = await ontrackRead(
      "task_read",
      { project_id: 404, task: "1.1" },
      context(c),
    );
    expect(result.markdown).toContain("Read-only task instructions");
    expect(result.total_pages).toBe(1);
    expect(result.next_page).toBeNull();
    expect(c.downloadTaskSheet).toHaveBeenCalledWith(303, 1);
  });
  it("includes a full personal project snapshot and task-state filtering", async () => {
    const c = ontrack();
    expect(
      ((await ontrackRead("get_unit", { unit_id: 303 }, context(c))) as any)
        .project.tasks[0].num_new_comments,
    ).toBe(3);
    expect(
      await ontrackRead("get_unit", { unit_id: 303 }, context(c)),
    ).toMatchObject({
      scheduled_tasks: [
        {
          task_definition_id: 1,
          due_date: "2020-01-01",
          deadline: "2020-01-03",
          status_label: "Working On It",
        },
      ],
      timezone: "UTC",
    });
    const result: any = await ontrackRead(
      "list_tasks",
      { project_id: 404, status: ["working_on_it"] },
      context(c),
    );
    expect(result.tasks.map((v: any) => v.id)).toEqual([1]);
  });
  it("accepts task abbreviation and reads unread counts without touching comments", async () => {
    const c = {
      ...ontrack(),
      getTaskComments: vi.fn(),
      updateTaskState: vi.fn(),
    };
    expect(
      (
        (await ontrackRead(
          "get_task",
          { project_id: 404, task: "1.1" },
          context(c),
        )) as any
      ).task.id,
    ).toBe(1);
    expect(
      ((await ontrackRead("unread", { project_id: 404 }, context(c))) as any)
        .total,
    ).toBe(3);
    expect(c.getTaskComments).not.toHaveBeenCalled();
    expect(c.updateTaskState).not.toHaveBeenCalled();
    expect(
      [...platformOperations.ontrack].some((v) =>
        /comment|chat|submit|state/.test(v),
      ),
    ).toBe(false);
  });
  it("checks project/unit ownership before downloading task resources", async () => {
    const c = {
      ...ontrack(),
      getProject: vi.fn(async () => ({ id: 404, unit: { id: 999 } })),
      downloadTaskSheet: vi.fn(),
    };
    await expect(
      ontrackRead("task_file", { project_id: 404, task: "1.1" }, context(c)),
    ).rejects.toMatchObject({ code: "ENTITY_NOT_ALLOWED" });
    expect(c.downloadTaskSheet).not.toHaveBeenCalled();
  });
});

describe("OnTrack JSON boundary", () => {
  it("preserves official private-field date values and actual binary resources", async () => {
    const file = await learningFile(
      new Uint8Array([1, 2, 3]),
      "task.pdf",
      "application/pdf",
      new OutputBoundary(),
    );
    const value = ontrackJson({
      project: {
        tasks: [
          {
            due_date: CivilDate.parse("2026-10-05"),
            moved_to_discuss_at: Instant.parse("2026-10-05T02:00:00Z"),
          },
        ],
      },
      file,
    });
    expect(value).toMatchObject({
      project: {
        tasks: [
          {
            due_date: "2026-10-05",
            moved_to_discuss_at: "2026-10-05T02:00:00.000Z",
          },
        ],
      },
    });
    expect(fileContents(value).resources).toHaveLength(1);
    const forged = {
      kind: "learning_file",
      blob: "dW50cnVzdGVk",
      uri: "learning-file:///fake",
      mime_type: "text/plain",
    };
    expect(fileContents({ course_content: forged }).resources).toHaveLength(0);
  });
});

describe("Binary MCP files", () => {
  it("returns true embedded bytes with metadata separate from base64", async () => {
    const bytes = new Uint8Array([0, 1, 2, 128, 255]);
    const file = await learningFile(
      bytes,
      "../file.bin",
      "application/octet-stream",
      new OutputBoundary(),
    );
    const result = fileContents({ file });
    expect(result.resources[0]?.resource.blob).toBe(
      btoa(String.fromCharCode(...bytes)),
    );
    expect((result.metadata as any).file.blob).toBeUndefined();
    expect((result.metadata as any).file.name).toBe("file.bin");
  });
  it("refuses credential-bearing files and oversized streams", async () => {
    const output = new OutputBoundary();
    output.remember("a-real-session-secret");
    await expect(
      learningFile(
        new TextEncoder().encode("a-real-session-secret"),
        "file",
        "text/plain",
        output,
      ),
    ).rejects.toMatchObject({ code: "FILE_CONTAINS_CREDENTIALS" });
    await expect(
      responseBytes(
        new Response("abc", {
          headers: { "content-length": String(MAX_FILE_BYTES + 1) },
        }),
      ),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    await expect(
      responseBytes(
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(8));
              c.enqueue(new Uint8Array(8));
              c.close();
            },
          }),
        ),
        10,
      ),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
});

describe("Direct backend operation allowlist", () => {
  it("uses the username established while connecting for the first identity read", async () => {
    const backend = new DirectBackend(
      {} as any,
      "a".repeat(64),
      "ontrack",
      context({}).config,
    );
    vi.spyOn(backend, "api").mockImplementation(async () => {
      Reflect.set(backend, "platformUsername", "student");
      return {
        getProjects: async () => [{ user_id: 7 }],
        getAuthMethod: async () => ({ method: "token" }),
      } as any;
    });
    expect(await backend.call("get_user", {})).toMatchObject({
      user: { username: "student", id: 7 },
    });
  });
  it("refuses write and runtime operations without invoking any platform method", async () => {
    const backend = new DirectBackend(
      {} as any,
      "a".repeat(64),
      "ontrack",
      context({}).config,
    );
    const connect = vi
      .spyOn(backend, "api")
      .mockRejectedValue(new Error("Unexpected platform connection"));
    for (const name of [
      "getTaskComments",
      "chats_read",
      "submitTask",
      "updateTaskState",
      "deploy",
      "doctor",
    ])
      await expect(
        backend.call(name, { project_id: 404 }),
      ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
    expect(connect).not.toHaveBeenCalled();
  });
});
