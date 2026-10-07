import { expect } from "vitest";
export const beta = {
  enabled: false,
  calls: [] as string[],
  failEdPost: false,
  failEdView: false,
  files: new Map<string, Uint8Array>(),
  assignmentStatus: "Draft (not submitted)",
  draftStage: true,
  group: "Team Example",
  quizStarted: false,
  quizPasswordRequired: false,
  quizFinished: false,
  quizPage: 0,
  quizAnswer: "",
  taskStatus: "not_started",
  chatCount: 0,
};
const moodle = "https://moodle.example.edu",
  ontrack = "https://ontrack.example.edu";
const html = (text: string) =>
  new Response(text, { headers: { "content-type": "text/html" } });
const redirect = (path: string) =>
  new Response(null, { status: 303, headers: { location: moodle + path } });
const fields = (action: string) =>
  `<input name="id" value="10"><input name="action" value="${action}"><input name="sesskey" value="session-a">`;
const statement =
  '<input type="checkbox" id="declaration" name="submissionstatement"><label for="declaration">This is my own submitted work.</label>';
function assignment() {
  return `<body class="course-202"><h1>Assignment 2</h1><table><tr><th>Submission status</th><td>${beta.assignmentStatus}</td></tr><tr><th>Group</th><td>${beta.group}</td></tr><tr><th>Last modified</th><td>Fixed timestamp</td></tr></table><div class="fileuploadsubmission">${[...beta.files.keys()].map((name) => `<a href="${moodle}/pluginfile.php/202/${name}">${name}</a>`).join("")}</div>${beta.draftStage ? `<form action="/mod/assign/view.php">${fields("submit")}</form>` : ""}</body>`;
}
export function quizAttemptPage(page: number) {
  const state = beta.quizAnswer ? "Answer saved" : "Not yet answered";
  return `<h1>Practice Quiz</h1><span class="qnbutton sequential" id="quiznavbutton1" data-quiz-page="0" title="Question 1 - ${state}">1</span><span class="qnbutton sequential" id="quiznavbutton2" data-quiz-page="1" title="Question 2 - Not yet answered">2</span><form id="responseform" action="/mod/quiz/processattempt.php?cmid=20"><input name="attempt" value="500"><input name="thispage" value="${page}"><input name="nextpage" value="${page}"><input name="sesskey" value="session-a"><div class="que shortanswer" id="question-1-${page + 1}"><div class="info"><span class="qno">${page + 1}</span><span class="state">${state}</span></div><div class="qtext">User answer question</div><input name="q1:${page + 1}_answer" value="${beta.quizAnswer}"></div></form>`;
}
export async function betaPlatform(
  req: Request,
): Promise<Response | undefined> {
  if (!beta.enabled) return undefined;
  const url = new URL(req.url);
  if (
    url.origin === moodle &&
    req.headers.get("cookie") !== "MoodleSession=moodle-a"
  )
    return undefined;
  if (
    url.origin === ontrack &&
    (req.headers.get("Username") !== "a" ||
      req.headers.get("Auth-Token") !== "ontrack-a")
  )
    return undefined;
  if (
    url.origin === "https://edstem.org" &&
    req.headers.get("authorization") !== "Bearer ed-user-a"
  )
    return undefined;
  if (url.origin === "https://edstem.org") {
    if (req.method !== "GET") {
      beta.calls.push(`${req.method} ${url.pathname}`);
      if (beta.failEdPost && url.pathname === "/api/courses/101/threads")
        return Response.json(
          { message: "private-error-canary" },
          { status: 503 },
        );
      if (url.pathname === "/api/courses/101/threads") {
        const body = (await req.json()) as { thread: Record<string, unknown> };
        expect(body.thread.content).toContain('<document version="2.0">');
        return Response.json({
          thread: { ...body.thread, id: 90, course_id: 101, user_id: 1 },
        });
      }
      if (url.pathname.endsWith("/comments"))
        return Response.json({
          comment: { id: 91, user_id: 1, content: "reply", type: "comment" },
        });
      if (url.pathname.endsWith("/complete"))
        return new Response(null, { status: 204 });
      if (url.pathname.includes("/questions/33/responses"))
        return Response.json({ correct: true, slide_completed: true });
      if (url.pathname.endsWith("/submit_all"))
        return Response.json({ submitted: true });
    }
    if (url.searchParams.get("view") === "1") {
      beta.calls.push(`GET view ${url.pathname}`);
      if (beta.failEdView) return new Response(null, { status: 503 });
    }
  }
  if (url.origin === ontrack) {
    if (url.pathname === "/api/projects/404/task_def_id/501/comments") {
      beta.calls.push(`${req.method} ${url.pathname}`);
      if (req.method === "POST") {
        const data = new URLSearchParams(await req.text());
        expect(data.get("comment")).toBe("Please review my work.");
        beta.chatCount++;
        return Response.json({
          id: 700,
          comment: data.get("comment"),
          type: "discussion",
          has_attachment: false,
          is_new: false,
          reply_to_id: null,
          recipient_read_time: null,
          author: {
            id: 7,
            first_name: "Student",
            last_name: "Example",
            email: "student@example.edu",
          },
          recipient: {
            id: 9,
            first_name: "Tutor",
            last_name: "Example",
            email: "tutor@example.edu",
          },
          created_at: "2026-01-01T00:00:00Z",
        });
      }
      return Response.json([
        {
          id: 701,
          comment: "Feedback",
          type: "feedback",
          has_attachment: false,
          reply_to_id: null,
          recipient_read_time: null,
          is_new: false,
          author: {
            id: 9,
            first_name: "Tutor",
            last_name: "Example",
            email: "tutor@example.edu",
          },
          recipient: {
            id: 7,
            first_name: "Student",
            last_name: "Example",
            email: "student@example.edu",
          },
          created_at: "2026-01-01T00:00:00Z",
        },
      ]);
    }
    if (
      url.pathname === "/api/projects/404/task_def_id/501" &&
      req.method === "PUT"
    ) {
      beta.calls.push(`${req.method} ${url.pathname}`);
      beta.taskStatus = ((await req.json()) as { trigger: string }).trigger;
      return Response.json({
        id: 600,
        task_definition_id: 501,
        status: beta.taskStatus,
      });
    }
    if (url.pathname.endsWith("/501/submission") && req.method === "POST") {
      beta.calls.push(`${req.method} ${url.pathname}`);
      const form = await req.formData();
      expect(form.get("trigger")).toBe("ready_for_feedback");
      const file = form.get("file0") as File;
      expect(file.name).toBe("essay.txt");
      expect(await file.text()).toBe("User authored file");
      return Response.json(
        { id: 600, task_definition_id: 501, status: "ready_for_feedback" },
        { status: 201 },
      );
    }
  }
  if (url.origin !== moodle) return undefined;
  if (url.pathname === "/mod/assign/view.php") {
    const action = url.searchParams.get("action");
    if (req.method === "POST") {
      const form = new URLSearchParams(await req.text());
      beta.calls.push(`POST assignment ${form.get("action")}`);
      if (form.get("action") === "confirmsubmit") {
        expect(form.get("submissionstatement")).toBe("1");
        beta.assignmentStatus = "Submitted for grading";
      } else if (!beta.draftStage)
        beta.assignmentStatus = "Submitted for grading";
      return redirect("/mod/assign/view.php?id=10");
    }
    if (action === "editsubmission") {
      const opts = {
        itemid: 42,
        client_id: "picker",
        context: { id: 202 },
        maxbytes: 16000000,
        maxfiles: 5,
        accepted_types: [".txt"],
        filepicker: { repositories: [{ id: 1, type: "upload" }] },
      };
      return html(
        `<form action="/mod/assign/view.php">${fields("savesubmission")}<input name="files_filemanager" value="42">${beta.draftStage ? "" : statement}</form><script>M.form_filemanager.init(Y, ${JSON.stringify(opts)});</script>`,
      );
    }
    if (action === "submit")
      return html(
        `<form action="/mod/assign/view.php">${fields("confirmsubmit")}${statement}</form>`,
      );
    return html(assignment());
  }
  if (url.pathname === "/repository/draftfiles_ajax.php") {
    const action = url.searchParams.get("action");
    if (action === "list")
      return Response.json({
        list: [...beta.files].map(([filename, bytes]) => ({
          filename,
          size: bytes.length,
          filepath: "/",
        })),
      });
    beta.calls.push("POST draft delete");
    beta.files.clear();
    return Response.json(true);
  }
  if (url.pathname === "/repository/repository_ajax.php") {
    const form = await req.formData();
    expect(form.get("sesskey")).toBe("session-a");
    const file = form.get("repo_upload_file") as File;
    beta.files.set(file.name, new Uint8Array(await file.arrayBuffer()));
    beta.calls.push("POST draft upload");
    return Response.json({ file: file.name });
  }
  if (url.pathname === "/mod/quiz/view.php")
    return html(
      `<h1>Practice Quiz</h1>${!beta.quizStarted ? '<form action="/mod/quiz/startattempt.php"><input name="cmid" value="20"><input name="sesskey" value="session-a"><button>Attempt quiz</button></form>' : `<a href="/mod/quiz/attempt.php?attempt=500&cmid=20">Continue attempt</a><div class="card"><h2 class="card-title">Attempt 1</h2><table class="quizreviewsummary"><tr><th>Status</th><td>${beta.quizFinished ? "Finished" : "In progress"}</td></tr></table><a href="/mod/quiz/review.php?attempt=500">Review</a></div>`}`,
    );
  if (url.pathname === "/mod/quiz/startattempt.php") {
    const body = new URLSearchParams(await req.text());
    if (beta.quizPasswordRequired && !body.get("quizpassword")) {
      beta.calls.push("POST quiz preflight");
      return html(
        '<form action="/mod/quiz/startattempt.php"><input name="cmid" value="20"><input name="sesskey" value="session-a"><input name="quizpassword" type="password"></form>',
      );
    }
    if (beta.quizPasswordRequired)
      expect(body.get("quizpassword")).toBe("quiz-password-canary");
    beta.calls.push("POST quiz start");
    beta.quizStarted = true;
    return redirect("/mod/quiz/attempt.php?attempt=500&cmid=20");
  }
  if (url.pathname === "/mod/quiz/attempt.php") {
    if (beta.quizFinished)
      return redirect("/mod/quiz/review.php?attempt=500&cmid=20");
    const requested = Number(url.searchParams.get("page") ?? 0);
    if (requested > beta.quizPage) {
      beta.calls.push("GET quiz advance");
      beta.quizPage = requested;
    }
    return html(quizAttemptPage(beta.quizPage));
  }
  if (url.pathname === "/mod/quiz/summary.php")
    return html(
      `<h1>Practice Quiz</h1><table class="quizsummaryofattempt"><tbody><tr><td>1</td><td>${beta.quizAnswer ? "Answer saved" : "Not yet answered"}</td></tr></tbody></table><form id="frm-finishattempt" action="/mod/quiz/processattempt.php?cmid=20"><input name="attempt" value="500"><input name="finishattempt" value="1"><input name="sesskey" value="session-a"></form>`,
    );
  if (url.pathname === "/mod/quiz/processattempt.php") {
    const form = new URLSearchParams(await req.text());
    beta.calls.push("POST quiz process");
    if (form.get("finishattempt") === "1") {
      beta.quizFinished = true;
      return redirect("/mod/quiz/review.php?attempt=500&cmid=20");
    }
    beta.quizAnswer = form.get(`q1:${beta.quizPage + 1}_answer`) ?? "";
    return redirect(
      `/mod/quiz/attempt.php?attempt=500&cmid=20&page=${beta.quizPage}`,
    );
  }
  return undefined;
}
