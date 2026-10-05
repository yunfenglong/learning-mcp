import { assertOwnership, type Unit } from "../domain/units.ts";
import type { Evidence, EvidenceSearch } from "../domain/evidence.ts";
import { SuiteError } from "../errors.ts";
import { object, plainText, rows, timestamp, type Backend } from "./backend.ts";

export class EdAdapter {
  constructor(private readonly backend: Backend) {}
  private course(unit: Unit) {
    if (!unit.ed_course_id)
      throw new SuiteError(
        "PLATFORM_NOT_CONFIGURED",
        "This unit has no Ed course.",
      );
    return unit.ed_course_id;
  }

  async lessons(unit: Unit, options: Record<string, unknown> = {}) {
    const result = rows(
      await this.backend.call("list_lessons", {
        ...options,
        courseId: this.course(unit),
      }),
      "lessons",
    );
    result.forEach((item) => assertOwnership(unit, "ed", item.courseId));
    return result;
  }

  async lesson(unit: Unit, lessonId: number) {
    const result = object(
      await this.backend.call("get_lesson", {
        lessonId,
        courseId: this.course(unit),
      }),
    );
    assertOwnership(unit, "ed", result.courseId);
    return result;
  }

  async threads(unit: Unit, options: Record<string, unknown> = {}) {
    const result = rows(
      await this.backend.call("list_threads", {
        limit: 100,
        sort: "new",
        ...options,
        courseId: this.course(unit),
      }),
      "threads",
    );
    result.forEach((item) => assertOwnership(unit, "ed", item.courseId));
    return result;
  }

  async thread(unit: Unit, threadId: number, includeHtml = true) {
    const result = object(
      await this.backend.call("get_thread", {
        threadId,
        includeHtml,
        courseId: this.course(unit),
      }),
    );
    assertOwnership(unit, "ed", result.courseId);
    return result;
  }

  async read(
    name: string,
    unit: Unit | undefined,
    options: Record<string, unknown> = {},
  ) {
    return this.backend.call(name, {
      ...options,
      ...(unit ? { courseId: this.course(unit) } : {}),
    });
  }

  async searchAttendance(unit: Unit): Promise<EvidenceSearch> {
    if (!unit.ed_course_id)
      return {
        evidence: [],
        coverage: { source: "ed", status: "not_configured", examined: 0 },
      };
    const lists = await Promise.allSettled([
      this.threads(unit),
      this.lessons(unit),
    ]);
    const threads = lists[0].status === "fulfilled" ? lists[0].value : [];
    const lessons = lists[1].status === "fulfilled" ? lists[1].value : [];
    const relevant = (item: Record<string, unknown>) =>
      /attendance|check.?in|签到|簽到|出席/i.test(String(item.title ?? ""));
    const selectedThreads = [
      ...threads.filter(relevant),
      ...threads.filter((item) => !relevant(item)),
    ].slice(0, 20);
    const selectedLessons = lessons.filter(relevant).slice(0, 8);
    const evidence: Evidence[] = [];
    let failed = lists.some((result) => result.status === "rejected"),
      examined = 0;
    const jobs = [
      ...selectedThreads.map((item) => ({
        type: "thread" as const,
        id: Number(item.id),
      })),
      ...selectedLessons.map((item) => ({
        type: "lesson" as const,
        id: Number(item.id),
      })),
    ];
    for (let offset = 0; offset < jobs.length; offset += 4) {
      const batch = await Promise.allSettled(
        jobs.slice(offset, offset + 4).map(async (job) => {
          const detail =
            job.type === "thread"
              ? await this.thread(unit, job.id)
              : await this.lesson(unit, job.id);
          const text =
            job.type === "thread"
              ? plainText([
                  detail.content || detail.document,
                  detail.answers,
                  detail.comments,
                ])
              : plainText([detail.outline, detail.slides]);
          return {
            source: "ed" as const,
            source_id: String(job.id),
            unit_key: unit.key,
            title: String(detail.title ?? ""),
            text,
            url: `https://edstem.org/us/courses/${unit.ed_course_id}/${job.type === "thread" ? "discussion" : "lessons"}/${job.id}`,
            published_at: timestamp(detail.createdAt),
          };
        }),
      );
      for (const result of batch)
        if (result.status === "fulfilled") {
          examined++;
          evidence.push(result.value);
        } else failed = true;
    }
    // This workflow scans a bounded recent set. Never claim a complete search.
    return {
      evidence,
      coverage: {
        source: "ed",
        status: "partial",
        examined,
        reason: failed
          ? "Some Ed reads failed; results cover a bounded recent-thread and lesson scan."
          : "This scan covers the 100 most recent Ed threads and selected lesson text. Other posts, slides and attachments may contain codes.",
      },
    };
  }
}
