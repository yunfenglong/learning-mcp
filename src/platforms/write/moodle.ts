import type { MoodleClientCore } from "../../../vendor/moodle/client.js";
import type { WriteArgs } from "../../capabilities/write/index.ts";
import { SuiteError } from "../../errors.ts";
import { required, requireOwner } from "../read/shared.ts";
import { fileManifest, prepared, type WriteContext } from "./shared.ts";
export async function moodleWrite(
  name: string,
  a: WriteArgs,
  ctx: WriteContext<MoodleClientCore>,
  execute = false,
): Promise<unknown> {
  const c = ctx.client,
    course = required(ctx.unit.moodle_course_id, "Moodle course");
  await ctx.enrolled(course);
  const user = await c.getSiteInfo();
  const ref = required(
    name === "submit_assignment" ? a.activity_id : a.quiz_id,
    "activity or quiz",
  );
  const activities = (await c.getCourseContents(course)).flatMap(
    (s) => s.activities,
  );
  const selected = activities.filter((v) =>
    typeof ref === "number"
      ? v.id === ref
      : v.name.toLowerCase() === ref.trim().toLowerCase(),
  );
  if (selected.length !== 1)
    throw new SuiteError(
      "ENTITY_NOT_ALLOWED",
      "Choose one activity ID or exact name from the selected course.",
      403,
    );
  const activity = selected[0]!;
  const isAssign = name === "submit_assignment";
  if (activity.modname !== (isAssign ? "assign" : "quiz"))
    throw new SuiteError(
      "ENTITY_NOT_ALLOWED",
      "This activity has the wrong type for the requested write.",
      403,
    );
  const detail = isAssign
    ? await c.getAssignment(activity.id)
    : await c.getQuiz(activity.id);
  if ("course_id" in detail && detail.course_id)
    requireOwner(detail.course_id, course);
  if (name === "submit_assignment") {
    const files = ctx.files.map((f) => ({ name: f.filename, bytes: f.bytes }));
    const request = {
      activityId: activity.id,
      files,
      final: a.final,
      replace: a.replace,
      acceptStatement: a.accept_statement,
    };
    // Planning may read the required declaration, but cannot accept it on the platform.
    let receipt;
    try {
      receipt = await c.submitAssignment({
        ...request,
        dryRun: true,
        acceptStatement: true,
      });
    } catch (error) {
      const problem = error as { code?: string; message?: string };
      if (
        !a.final &&
        problem.code === "usage" &&
        /no draft stage|does not show whether.*drafts/i.test(
          problem.message ?? "",
        )
      )
        receipt = await c.submitAssignment({
          ...request,
          final: true,
          dryRun: true,
          acceptStatement: true,
        });
      else throw error;
    }
    const {
      checked_at: _checked,
      time_remaining: _remaining,
      url: _url,
      files: existing,
      ...stable
    } = receipt;
    const plan = {
      target: {
        course_id: course,
        activity_id: activity.id,
        name: activity.name,
        user_id: user.userid,
        group: receipt.group,
      },
      changes: {
        files: fileManifest(ctx.files),
        final: a.final,
        replace: a.replace,
        accept_statement: a.accept_statement,
      },
      irreversible: Boolean(a.final),
      requirements: [
        ...(receipt.draft_stage !== true && !a.final ? ["final: true"] : []),
        ...(receipt.statement && !a.accept_statement
          ? ["accept_statement: true"]
          : []),
      ],
      warnings: [
        ...(receipt.group
          ? ["This changes the shared submission for all group members."]
          : []),
        ...(receipt.draft_stage !== true
          ? [
              "Saving may immediately submit for grading; a final submission is required.",
            ]
          : []),
        ...(receipt.statement
          ? [
              "Review the exact declaration and explicitly accept it before execution.",
            ]
          : []),
      ],
      state: {
        ...stable,
        files: existing.map(({ name, bytes }) => ({ name, bytes })),
        statement_accepted: Boolean(a.accept_statement),
      },
    };
    if (!execute) return prepared(plan);
    if (receipt.draft_stage !== true && !a.final)
      throw new SuiteError(
        "FINAL_SUBMISSION_REQUIRED",
        "Saving may submit immediately for grading. Prepare a new preview with final: true only if you intend final submission.",
        409,
      );
    if (receipt.statement && !a.accept_statement)
      throw new SuiteError(
        "STATEMENT_ACCEPTANCE_REQUIRED",
        "Review the declaration and prepare a preview with accept_statement: true.",
        409,
      );
    return {
      submission: await c.submitAssignment({ ...request, dryRun: false }),
    };
  }
  const quiz = await c.getQuiz(activity.id);
  const target = {
    course_id: course,
    quiz_id: activity.id,
    name: activity.name,
    user_id: user.userid,
    attempt_id: a.attempt_id,
  };
  const warnings = [
    "Moodle quiz operations are beta. Use only where the assessment permits this workflow.",
  ];
  if (name === "quiz_start") {
    const active = quiz.attempts.filter((v) => /in progress/i.test(v.status));
    if (active.length > 1)
      throw new SuiteError(
        "ENTITY_NOT_ALLOWED",
        "Moodle returned multiple active attempts. Check the quiz in a browser.",
        409,
      );
    const start = active.length
      ? {
          quiz_id: activity.id,
          name: quiz.name,
          action: "continue" as const,
          time_limit: quiz.time_limit,
          attempts_allowed: quiz.attempts_allowed,
          attempts_used: quiz.attempts.length,
          attempt_id: active[0]!.id,
        }
      : await c.planQuizStart(activity.id);
    if (!execute)
      return prepared({
        target,
        changes: start,
        irreversible: start.action === "start",
        warnings: [
          ...warnings,
          "A new attempt can consume an attempt allowance and start a timer immediately.",
        ],
      });
    return { attempt: await c.startQuizAttempt(activity.id) };
  }
  const attempt = required(a.attempt_id, "attempt_id");
  if (!quiz.attempts.some((v) => v.id === attempt))
    throw new SuiteError(
      "ENTITY_NOT_ALLOWED",
      "This attempt is not listed for the current user and quiz.",
      403,
    );
  const current = await c.getQuizAttemptPage(attempt, activity.id);
  if (name === "quiz_page") {
    const requested = required(a.page, "page") - 1;
    if (
      requested >= current.pages ||
      requested < 0 ||
      (current.navigation_method === "sequential" &&
        requested !== current.page &&
        requested !== current.page + 1)
    )
      throw new SuiteError(
        "INVALID_INPUT",
        "Choose a valid page; a sequential quiz can only advance one page.",
      );
    if (!execute)
      return prepared({
        target,
        changes: {
          page: a.page,
          current_page: current.page + 1,
          navigation_method: current.navigation_method,
        },
        irreversible:
          current.navigation_method === "sequential" &&
          requested > current.page,
        warnings: [
          ...warnings,
          ...(current.navigation_method === "sequential" &&
          requested > current.page
            ? ["Advancing permanently locks the current page and its answers."]
            : []),
        ],
        state: { navigation: current.navigation, questions: current.questions },
      });
    return {
      attempt: await c.getQuizAttemptPage(attempt, activity.id, requested, {
        advance: true,
      }),
    };
  }
  if (name === "quiz_answer") {
    const question = required(a.question, "question").trim(),
      nav = current.navigation.find((q) => q.number === question);
    if (!nav)
      throw new SuiteError(
        "ENTITY_NOT_ALLOWED",
        "This question is not in the selected attempt.",
        403,
      );
    if (current.navigation_method === "sequential" && nav.page !== current.page)
      throw new SuiteError(
        "INVALID_INPUT",
        "Answer the current page before confirming a separate page advance.",
      );
    const page =
      nav.page === current.page
        ? current
        : await c.getQuizAttemptPage(attempt, activity.id, nav.page);
    if (!execute)
      return prepared({
        target,
        changes: { question, value: a.value },
        irreversible: true,
        warnings,
        state: { page: page.page, questions: page.questions },
      });
    return {
      attempt: await c.answerQuizQuestion({
        attemptId: attempt,
        quizId: activity.id,
        question,
        value: required(a.value, "value"),
      }),
    };
  }
  if (name === "quiz_finish") {
    const summary = await c.getQuizAttemptSummary(attempt, activity.id);
    if (!execute)
      return prepared({
        target,
        changes: { submit_all_and_finish: true },
        irreversible: true,
        warnings: [
          ...warnings,
          "This finishes the attempt and submits all saved answers for grading. It cannot be undone.",
        ],
        state: summary.rows,
      });
    return { submission: await c.finishQuizAttempt(attempt, activity.id) };
  }
  throw new SuiteError("TOOL_NOT_ALLOWED", "Unknown Moodle write.", 403);
}
