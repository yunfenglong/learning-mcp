import type { PlatformConfig } from "../config.ts";
import { assertOwnership, type Unit } from "../domain/units.ts";
import type { Evidence, EvidenceSearch } from "../domain/evidence.ts";
import type { AttendanceQuery } from "../workflows/attendance.ts";
import { SuiteError } from "../errors.ts";
import { object, plainText, rows, timestamp, type Backend } from "./backend.ts";

export class MoodleAdapter {
  private checked?: Promise<void>;
  constructor(
    private readonly backend: Backend,
    private readonly config?: PlatformConfig,
  ) {}
  private async checkSite() {
    if (!this.config)
      throw new SuiteError("PLATFORM_NOT_CONFIGURED", "Configure Moodle.");
    this.checked ??= (async () => {
      const user = object(object(await this.backend.call("get_user", {})).user);
      if (
        typeof user.siteurl !== "string" ||
        new URL(user.siteurl).origin !== new URL(this.config!.site_url).origin
      )
        throw new SuiteError(
          "SITE_NOT_ALLOWED",
          "The authenticated Moodle site does not match this Learning deployment.",
          403,
        );
    })();
    await this.checked;
  }
  private course(unit: Unit) {
    if (!unit.moodle_course_id)
      throw new SuiteError(
        "PLATFORM_NOT_CONFIGURED",
        "This unit has no Moodle course.",
      );
    return unit.moodle_course_id;
  }

  async unit(unit: Unit, section?: number) {
    await this.checkSite();
    const result = object(
      await this.backend.call("unit", {
        unit: this.course(unit),
        ...(section === undefined ? {} : { section }),
      }),
    );
    assertOwnership(unit, "moodle", object(result.unit).id);
    return result;
  }

  async due(unit: Unit, days: number) {
    await this.checkSite();
    const result = rows(
      await this.backend.call("due", {
        unit: this.course(unit),
        days,
        limit: 100,
      }),
      "due",
    );
    result.forEach((item) => assertOwnership(unit, "moodle", item.unit_id));
    return result;
  }

  async grades(unit: Unit) {
    await this.checkSite();
    const result = object(
      await this.backend.call("grades", { unit: this.course(unit) }),
    );
    for (const item of rows(result, "grades"))
      assertOwnership(unit, "moodle", item.unit_id);
    return result;
  }

  async search(unit: Unit, query: string) {
    await this.checkSite();
    const result = object(
      await this.backend.call("search_forums", {
        courseId: this.course(unit),
        query,
        includePostText: true,
        limit: 30,
        maxForums: 10,
        maxDiscussionsPerForum: 20,
        sortBy: "recent",
      }),
    );
    for (const item of rows(result, "results"))
      assertOwnership(unit, "moodle", item.unit_id);
    return result;
  }

  async thread(unit: Unit, discussionId: number) {
    await this.checkSite();
    const result = object(
      await this.backend.call("thread", {
        discussion_id: discussionId,
        limit: 50,
      }),
    );
    assertOwnership(unit, "moodle", object(result.thread).unit_id);
    return result;
  }

  async searchAttendance(
    unit: Unit,
    _query: AttendanceQuery,
  ): Promise<EvidenceSearch> {
    if (!unit.moodle_course_id)
      return {
        evidence: [],
        coverage: { source: "moodle", status: "not_configured", examined: 0 },
      };
    const results = await Promise.allSettled(
      ["attendance code", "check-in code", "签到码", "出席码"].map((query) =>
        this.search(unit, query),
      ),
    );
    const evidence: Evidence[] = [],
      discussions = new Map<number, string>();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const hit of rows(result.value, "results")) {
        const discussion = Number(hit.discussion_id);
        if (!Number.isSafeInteger(discussion) || discussion <= 0) continue;
        discussions.set(discussion, String(hit.name ?? ""));
      }
    }
    // Search snippets can omit dates or codes. Read full post text before extracting candidates.
    const details = await Promise.allSettled(
      [...discussions.entries()].slice(0, 8).map(async ([id, name]) => {
        const detail = object((await this.thread(unit, id)).thread);
        const posts =
          detail.posts === undefined && detail.posts_total === 0
            ? []
            : rows(detail, "posts");
        return posts.map((post) => ({
          source: "moodle" as const,
          source_id: String(post.id),
          unit_key: unit.key,
          title: String(detail.name ?? name),
          text: plainText(post.message_text),
          url: `${this.config!.site_url.replace(/\/$/, "")}/mod/forum/discuss.php?d=${id}#p${post.id}`,
          published_at: timestamp(post.time_created),
        }));
      }),
    );
    for (const result of details)
      if (result.status === "fulfilled") evidence.push(...result.value);
    // Forum search is bounded and cannot prove that pages, files or classroom-only codes were searched.
    return {
      evidence,
      coverage: {
        source: "moodle",
        status: results.every((r) => r.status === "rejected")
          ? "unavailable"
          : "partial",
        examined: evidence.length,
        reason:
          "Search covers bounded Moodle forum text. Pages, attachments and classroom-only codes are outside this scan.",
      },
    };
  }
}
