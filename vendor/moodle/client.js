// src/resolve.ts
var ReferenceError = class extends Error {
  constructor(code, message, candidates) {
    super(message);
    this.code = code;
    this.candidates = candidates;
    this.name = "ReferenceError";
  }
  code;
  candidates;
  hint = "Run `moodle units` to see this site's names, or refine the reference.";
};
var normalize = (value) => value.normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/gu, " ");
var words = (value) => normalize(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
var tokensMatch = (text, query) => normalize(query).split(" ").every((token) => tokenMatches(normalize(text), token));
function tokenMatches(text, token) {
  if (/^\d+$/u.test(token)) return (text.match(/\b\d+\b/gu) ?? []).some((n) => Number(n) === Number(token));
  if (text.includes(token)) return true;
  const short = /^(\p{L}+)(\d+)$/u.exec(token);
  return short !== null && new RegExp(`(?:^|[^\\p{L}])${short[1]}\\p{L}*[\\s:.#-]*0*${Number(short[2])}(?!\\d)`, "u").test(text);
}
var named = (course, raw) => [course.shortname, course.fullname].some((name) => normalize(name) === raw);
function resolveUnit(value, courses) {
  if (typeof value === "number") {
    const byId = courses.find((c) => c.id === value);
    if (byId) return byId;
    throw unitError("not_found", value, courses);
  }
  const raw = normalize(String(value));
  const exact = courses.filter((c) => named(c, raw));
  if (raw && exact.length === 1) return exact[0];
  let id = /^\d+$/u.test(raw) ? Number(raw) : void 0;
  try {
    const url = new URL(String(value));
    if (url.pathname.endsWith("/course/view.php")) id = Number(url.searchParams.get("id"));
  } catch {
  }
  const course = courses.find((c) => c.id === id);
  if (course) return course;
  const matches = exact.length ? exact : courses.filter((c) => [c.shortname, c.fullname].some((name) => normalize(name).includes(raw)));
  if (raw && matches.length === 1) return matches[0];
  if (raw && matches.length > 1) throw unitError("ambiguous", value, matches);
  throw unitError("not_found", value, courses);
}
function unitError(code, ref, courses) {
  const candidates = courses.map((c) => ({ id: c.id, name: c.fullname || c.shortname, code: c.shortname || void 0 }));
  return new ReferenceError(code, `${code === "ambiguous" ? "Several units match" : "No unit matches"} '${ref}'. Your units: ${courses.map((c) => c.shortname || c.fullname).join(", ")}.`, candidates);
}
function resolveSection(ref, sections) {
  const raw = normalize(String(ref));
  const labels = sectionLabels(sections);
  const label = (s) => labels.get(s.id) ?? s.name;
  const numbers = raw.match(/\b\d+\b/gu) ?? [];
  let matches = sections.filter((s) => numbers.length === 1 ? (label(s).match(/\b\d+\b/gu) ?? []).some((n) => Number(n) === Number(numbers[0])) && (raw === numbers[0] || tokensMatch(label(s), raw)) : normalize(label(s)).includes(raw));
  const named2 = matches.filter((s) => tokensMatch(s.name, raw));
  if (matches.length > 1 && named2.length) matches = named2;
  if (matches.length === 1) return { section: matches[0] };
  if (matches.length > 1) throw new ReferenceError("ambiguous", `Several sections match '${ref}'.`, matches.map((s) => ({ id: s.id, name: label(s) })));
  if (/^\d+$/u.test(raw)) {
    const positional = sections.filter((s) => s.section === Number(raw));
    if (positional.length === 1) return { section: positional[0], positional: true };
  }
  throw new ReferenceError("not_found", `No section matches '${ref}'.`, sections.map((s) => ({ id: s.id, name: s.name })));
}
function searchSections(course, sections, query) {
  const rows = [];
  const labels = sectionLabels(sections);
  for (const s of sections) {
    const label = labels.get(s.id) ?? s.name;
    const context = { unit_id: course.id, unit_code: course.shortname || course.fullname, section_id: s.id, section: label };
    if (tokensMatch(s.name, query)) rows.push({ ...context, id: s.id, name: s.name, type: "section", score: words(s.name) === words(query) ? 100 : 70 });
    for (const a of s.activities) {
      if (!tokensMatch(`${a.name} ${label}`, query)) continue;
      const chrome = ["label", "cms"].includes(a.modname);
      const score = chrome ? 1 : words(a.name) === words(query) ? 100 : tokensMatch(a.name, query) ? 80 : 60;
      rows.push({ ...context, id: a.id, name: a.name, type: a.modname, score, activity: a });
    }
  }
  const useful = rows.filter((r) => r.score > 1);
  return (useful.length ? useful : rows).sort((a, b) => b.score - a.score || a.id - b.id);
}
function parentsOf(sections) {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const parents = /* @__PURE__ */ new Map();
  if (sections.some((s) => s.parent !== void 0)) {
    const holders = new Set(sections.map((s) => s.parent));
    const headings = new Set(sections.filter((s) => holders.has(s.id)).map((s) => s.parent));
    for (const s of sections) {
      const parent = s.parent === void 0 || headings.has(s.parent) ? void 0 : byId.get(s.parent);
      if (parent) parents.set(s.id, parent);
    }
    return parents;
  }
  const counts = /* @__PURE__ */ new Map();
  for (const s of sections) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  let last;
  for (const s of sections) {
    if ((counts.get(s.name) ?? 0) < 2) last = s;
    else if (last) parents.set(s.id, last);
  }
  return parents;
}
function sectionLabels(sections) {
  const parents = parentsOf(sections);
  const name = (s) => s.name || `Section ${s.section}`;
  return new Map(sections.map((s) => {
    const parent = parents.get(s.id);
    return [s.id, parent ? `${name(parent)} \u203A ${name(s)}` : name(s)];
  }));
}
function sectionTree(sections) {
  const parents = parentsOf(sections);
  const tree = sections.filter((s) => !parents.has(s.id)).map((section) => ({ section, children: [] }));
  const nodes = new Map(tree.map((node) => [node.section.id, node]));
  for (const s of sections) nodes.get(parents.get(s.id)?.id ?? NaN)?.children.push(s);
  return tree;
}
function withChildSections(section, sections) {
  const node = sectionTree(sections).find((n) => n.section.id === section.id);
  return node ? [node.section, ...node.children] : [section];
}

// src/session-fetch.ts
var MAX_REDIRECTS = 5;
var REQUEST_TIMEOUT_MS = 3e4;
var REDIRECT_STATUSES = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
async function fetchWithSession(input, init, moodleOrigin, cookie, fetchImpl = (url, options) => fetch(url, options)) {
  let url = new URL(input);
  const initialOrigin = url.origin;
  const trustedOrigin = new URL(moodleOrigin).origin;
  let method = (init.method ?? "GET").toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers);
  const deadline = new AbortController();
  let timer;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
    timer.unref?.();
  };
  const signal = init.signal ? AbortSignal.any([init.signal, deadline.signal]) : deadline.signal;
  for (let hop = 0; ; hop += 1) {
    signal.throwIfAborted();
    arm();
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("The request destination is not allowed.");
    }
    headers.delete("cookie");
    if (url.origin === trustedOrigin) headers.set("cookie", `${cookie.name}=${cookie.value}`);
    if (url.origin !== initialOrigin) {
      headers.delete("authorization");
      headers.delete("proxy-authorization");
    }
    let response;
    try {
      response = await fetchImpl(url.toString(), { ...init, method, body, headers: Object.fromEntries(headers), signal, redirect: "manual" });
    } catch (error) {
      clearTimeout(timer);
      throw requestFailure(error, url, deadline.signal);
    }
    if (!REDIRECT_STATUSES.has(response.status) || !response.headers.get("location")) return watchBody(response, arm, () => clearTimeout(timer));
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new Error("The request exceeded its redirect limit.");
    const next = new URL(location, url);
    if (url.protocol === "https:" && next.protocol !== "https:") {
      throw new Error("The request refused an insecure redirect.");
    }
    if (next.origin !== url.origin && method !== "GET" && method !== "HEAD") {
      throw new Error("The request refused a cross-origin form redirect.");
    }
    if (response.status === 303 && method !== "HEAD" || [301, 302].includes(response.status) && method === "POST") {
      method = "GET";
      body = void 0;
      for (const header of ["content-type", "content-length", "content-encoding", "content-language", "content-location"]) headers.delete(header);
    }
    url = next;
  }
}
function watchBody(response, arm, done) {
  if (!response.body) {
    done();
    return response;
  }
  arm();
  const body = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      arm();
      controller.enqueue(chunk);
    },
    flush: done
  }));
  const watched = new Response(body, response);
  Object.defineProperty(watched, "url", { value: response.url });
  return watched;
}
var RequestFailed = class extends Error {
  host;
  timedOut;
  constructor(host, timedOut, cause) {
    super(timedOut ? `${host} did not respond within ${REQUEST_TIMEOUT_MS / 1e3}s.` : `Could not reach ${host}: ${cause}`);
    this.name = "RequestFailed";
    this.host = host;
    this.timedOut = timedOut;
  }
};
function requestFailure(error, url, deadline) {
  if (deadline.aborted) {
    return new RequestFailed(url.host, true);
  }
  if (!(error instanceof Error)) {
    return error;
  }
  return new RequestFailed(url.host, false, error.cause instanceof Error ? error.cause.message : error.message);
}

// src/moodle-client-core.ts
import { z } from "zod";

// src/constants.ts
var PACKAGE_NAME = "moodle-cli";
var NPM_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
var AJAX_SERVICE_PATH = "/lib/ajax/service.php";
var DASHBOARD_PATH = "/my/";
var COURSE_PATH = "/course/view.php";
var ASSIGN_VIEW_PATH = "/mod/assign/view.php";
var QUIZ_VIEW_PATH = "/mod/quiz/view.php";
var QUIZ_REVIEW_PATH = "/mod/quiz/review.php";
var QUIZ_START_PATH = "/mod/quiz/startattempt.php";
var QUIZ_ATTEMPT_PATH = "/mod/quiz/attempt.php";
var QUIZ_SUMMARY_PATH = "/mod/quiz/summary.php";
var QUIZ_PROCESS_PATH = "/mod/quiz/processattempt.php";
var RESOURCE_VIEW_PATH = "/mod/resource/view.php";
var URL_VIEW_PATH = "/mod/url/view.php";
var PAGE_VIEW_PATH = "/mod/page/view.php";
var FOLDER_VIEW_PATH = "/mod/folder/view.php";
var FORUM_DISCUSS_PATH = "/mod/forum/discuss.php";
var FORUM_VIEW_PATH = "/mod/forum/view.php";
var GRADE_REPORT_INDEX_PATH = "/grade/report/index.php";
var GRADE_REPORT_OVERVIEW_PATH = "/grade/report/overview/index.php";
var GRADE_REPORT_PATH = "/grade/report/user/index.php";
var FUNC_GET_SITE_INFO = "core_webservice_get_site_info";
var FUNC_GET_COURSES = "core_enrol_get_users_courses";
var FUNC_GET_COURSES_BY_TIMELINE = "core_course_get_enrolled_courses_by_timeline_classification";
var FUNC_GET_COURSE_CONTENTS = "core_course_get_contents";
var FUNC_GET_COURSE_FORMAT_STATE = "core_courseformat_get_state";
var FUNC_GET_COURSE_MODULE = "core_course_get_course_module";
var FUNC_GET_ACTION_EVENTS = "core_calendar_get_action_events_by_timesort";
var FUNC_GET_ACTION_EVENTS_BY_COURSE = "core_calendar_get_action_events_by_course";
var FUNC_GET_POPUP_NOTIFICATIONS = "message_popup_get_popup_notifications";
var FUNC_GET_CONVERSATION_COUNTS = "core_message_get_conversation_counts";
var FUNC_GET_UNREAD_CONVERSATION_COUNTS = "core_message_get_unread_conversation_counts";
var FUNC_GET_DISCUSSION_POSTS = "mod_forum_get_discussion_posts";
var FUNC_GET_STRINGS = "core_get_strings";
var DEFAULT_SESSION_CACHE_TTL_MS = 24 * 60 * 60 * 1e3;

// src/moodle-assign-core.ts
import { parse as parse3 } from "node-html-parser";

// src/html-utils.ts
import { parse } from "node-html-parser";
function htmlToStructuredContent(html, baseUrl) {
  if (!html) {
    return { text: "", image_urls: [], links: [], tables: [] };
  }
  const root = parse(html);
  const image_urls = [];
  const links = [];
  const tables = [];
  for (const br of root.querySelectorAll("br")) {
    br.replaceWith("\n");
  }
  for (const img of root.querySelectorAll("img")) {
    const src = (img.getAttribute("src") ?? "").trim();
    if (!src) {
      img.replaceWith("[image]");
      continue;
    }
    const absolute = resolveUrl(baseUrl, src);
    image_urls.push(absolute);
    const label = (img.getAttribute("alt") ?? "").trim() || "image";
    img.replaceWith(`[${label}] ${absolute}`);
  }
  for (const link of root.querySelectorAll("a[href]")) {
    const href = (link.getAttribute("href") ?? "").trim();
    if (!href) {
      continue;
    }
    links.push({ text: cleanText(link.textContent), url: resolveUrl(baseUrl, href) });
  }
  for (const table of root.querySelectorAll("table")) {
    const headers = [];
    const rows = [];
    for (const row of table.querySelectorAll("tr")) {
      const headerCells = row.querySelectorAll("th");
      const dataCells = row.querySelectorAll("td");
      const cells = headerCells.length ? headerCells : dataCells;
      if (!cells.length) {
        continue;
      }
      const values = cells.map((cell) => cleanText(cell.textContent));
      if (headerCells.length && !headers.length && !rows.length) {
        headers.push(...values);
      } else {
        rows.push(values);
      }
    }
    if (headers.length || rows.length) {
      tables.push({ headers, rows });
    }
  }
  const text = root.textContent.split(/\r?\n/).map((line) => cleanText(line)).filter(Boolean).join("\n");
  return { text, image_urls, links, tables };
}
function cleanText(value) {
  return decodeHtml(value ?? "").replace(/\s+/g, " ").trim();
}
function resolveUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}
function decodeHtml(value) {
  return value.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// src/site-labels.ts
var LABEL_STRINGS = {
  "Submission status": [["mod_assign", "submissionstatus"], ["mod_assign", "submissionstatusheading"]],
  "Grading status": [["mod_assign", "gradingstatus"]],
  "Time remaining": [["mod_assign", "timeremaining"]],
  "Grade": [["core", "gradenoun"], ["core_grades", "gradenoun"], ["mod_assign", "gradenoun"], ["mod_quiz", "grade"]],
  "Graded on": [["mod_assign", "gradedon"]],
  "Graded by": [["mod_assign", "gradedby"]],
  "Feedback comments": [["assignfeedback_comments", "pluginname"]],
  "Due:": [["mod_assign", "activitydate:submissionsdue"], ["core_course", "activitydate:due"]],
  "Opens:": [["core_course", "activitydate:opens"], ["mod_assign", "activitydate:submissionsopen"]],
  "Closes:": [["core_course", "activitydate:closes"]],
  "Attempts allowed:": [["mod_quiz", "attemptsallowed"]],
  "Time limit:": [["mod_quiz", "timelimit"]],
  "Status": [["mod_quiz", "attemptstate"], ["core", "status"]],
  "Started": [["mod_quiz", "startedon"]],
  "Completed": [["mod_quiz", "completedon"]],
  "Duration": [["mod_quiz", "attemptduration"]],
  "Marks": [["mod_quiz", "marks"]]
};
function labelRequests() {
  const seen = /* @__PURE__ */ new Set();
  const requests = [];
  for (const refs of Object.values(LABEL_STRINGS)) {
    for (const [component, stringid] of refs) {
      const key = `${component}/${stringid}`;
      if (!seen.has(key)) {
        seen.add(key);
        requests.push({ stringid, component });
      }
    }
  }
  return requests;
}
function siteLabelsFrom(data) {
  const texts = /* @__PURE__ */ new Map();
  for (const item of Array.isArray(data) ? data : []) {
    const { component, stringid, string } = item ?? {};
    if (typeof string === "string" && string && !/^\[\[.*\]\]$/u.test(string)) texts.set(`${component}/${stringid}`, string);
  }
  const labels = {};
  for (const [label, refs] of Object.entries(LABEL_STRINGS)) {
    const found = [...new Set(refs.map(([component, id]) => texts.get(`${component}/${id}`)).filter((text) => Boolean(text)))];
    if (found.length) labels[label] = found;
  }
  return labels;
}
function labelKey(text) {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim().replace(/\s*[:：]$/u, "").toLowerCase();
}
function labelTexts(label, labels) {
  return [label, ...labels?.[label] ?? []];
}

// src/scraper.ts
import { parse as parse2 } from "node-html-parser";

// src/parsers.ts
function schema(parser) {
  return { parse: parser };
}
var UserInfoSchema = schema(parseUserInfo);
var CourseSchema = schema(parseCourse);
var CoursesSchema = schema(parseCourses);
var ActivitySchema = schema(parseActivity);
var SectionSchema = schema(parseSection);
var CourseContentsSchema = schema(parseCourseContents);
var TodoItemSchema = schema(parseTodoItem);
function normalizeGradeType(type) {
  const normalized = type.trim().toLowerCase();
  return normalized === "assignment" ? "assign" : normalized;
}
function parseGradeItem(value) {
  const data = asRecord(value);
  const item = {
    name: stringValue(data.name),
    item_type: stringValue(data.item_type),
    modname: normalizeGradeType(stringValue(data.item_type)),
    grade: stringValue(data.grade),
    range: stringValue(data.range),
    percentage: stringValue(data.percentage),
    weight: stringValue(data.weight),
    contribution: stringValue(data.contribution),
    feedback: stringValue(data.feedback),
    url: stringValue(data.url),
    status: stringValue(data.status)
  };
  try {
    const url = new URL(item.url);
    const match = /\/mod\/([^/]+)\/view\.php$/u.exec(url.pathname);
    if (match) {
      item.modname = normalizeGradeType(match[1]);
      const cmid = Number(url.searchParams.get("id"));
      if (Number.isSafeInteger(cmid) && cmid > 0) item.cmid = cmid;
    }
  } catch {
  }
  return item;
}
function parseUserInfo(value) {
  const data = asRecord(value);
  return {
    userid: numberValue(data.userid),
    username: stringValue(data.username),
    fullname: stringValue(data.fullname),
    sitename: stringValue(data.sitename),
    siteurl: stringValue(data.siteurl),
    lang: stringValue(data.lang),
    ...data.timezone ? { timezone: String(data.timezone) } : {}
  };
}
function parseCourse(value, nowSeconds = Math.floor(Date.now() / 1e3)) {
  const data = asRecord(value);
  const course = {
    id: numberValue(data.id),
    shortname: stringValue(data.shortname),
    fullname: stringValue(data.fullname),
    category: numberValue(data.category),
    visible: booleanValue(data.visible, true),
    startdate: numberValue(data.startdate)
  };
  const enddate = numberValue(data.enddate);
  if (enddate > 0) {
    course.enddate = enddate;
  }
  return course;
}
function parseCourses(value) {
  return asArray(value).map((item) => parseCourse(item));
}
function parseActivity(value) {
  const data = asRecord(value);
  return {
    id: numberValue(data.id),
    name: stringValue(data.name),
    modname: stringValue(data.modname),
    url: stringValue(data.url),
    visible: booleanValue(data.visible, true),
    description: stringValue(data.description),
    ...data.completiondata && typeof data.completiondata === "object" ? { completion: numberValue(asRecord(data.completiondata).state) } : {},
    ...Array.isArray(data.contents) ? { file_entries: data.contents.filter((f) => asRecord(f).fileurl).map((f) => ({ name: stringValue(asRecord(f).filename), url: stringValue(asRecord(f).fileurl), requires_authentication: true })) } : {}
  };
}
function parseSection(value) {
  const data = asRecord(value);
  return {
    id: numberValue(data.id),
    name: stringValue(data.name),
    section: numberValue(data.section),
    visible: booleanValue(data.visible, true),
    summary: stringValue(data.summary),
    ...data.current !== void 0 ? { current: booleanValue(data.current) } : {},
    activities: asArray(data.modules).map((item) => parseActivity(item))
  };
}
function parseCourseContents(value) {
  return asArray(value).map((item) => parseSection(item));
}
function parseCourseFormatState(value, baseUrl) {
  const state = asRecord(parseJsonValue(value));
  const activities = /* @__PURE__ */ new Map();
  const activitiesBySection = /* @__PURE__ */ new Map();
  for (const item of asArray(state.cm)) {
    const data = asRecord(item);
    const id = numberValue(data.id);
    const sectionId = stringValue(data.sectionid);
    const module = stringValue(data.module) || stringValue(data.plugin).replace(/^mod_/u, "") || stringValue(data.modname).toLowerCase();
    const activity = {
      id,
      name: htmlText(data.name, baseUrl),
      modname: module.toLowerCase(),
      url: stringValue(data.url) ? resolveUrl(baseUrl, stringValue(data.url)) : "",
      visible: booleanValue(data.visible, true) && booleanValue(data.uservisible, true) && !booleanValue(data.stealth),
      description: htmlText(data.content ?? data.description, baseUrl),
      ...data.completionstate !== void 0 && data.completionstate !== null ? { completion: numberValue(data.completionstate) } : {}
    };
    activities.set(String(id), activity);
    const sectionActivities = activitiesBySection.get(sectionId) ?? [];
    sectionActivities.push(activity);
    activitiesBySection.set(sectionId, sectionActivities);
  }
  return asArray(state.section).map((item) => {
    const data = asRecord(item);
    const id = numberValue(data.id);
    const hasActivityList = Array.isArray(data.cmlist);
    const listedActivities = asArray(data.cmlist).map((activityId) => activities.get(stringValue(activityId))).filter((activity) => activity !== void 0);
    const parent = numberValue(data.parentsectionid ?? data.parentid);
    return {
      id,
      name: htmlText(data.title || data.rawtitle, baseUrl),
      section: numberValue(data.section ?? data.number),
      visible: booleanValue(data.visible, true),
      summary: htmlText(data.summary, baseUrl),
      ...data.current !== void 0 ? { current: booleanValue(data.current) } : {},
      ...parent ? { parent } : {},
      activities: hasActivityList ? listedActivities : activitiesBySection.get(String(id)) ?? []
    };
  });
}
function parseTodoItem(value) {
  const data = asRecord(value);
  const course = asRecord(data.course);
  const action = asRecord(data.action);
  const progress = course.progress;
  return {
    id: numberValue(data.id),
    name: stringValue(data.name),
    activity_name: stringValue(data.activityname),
    modname: stringValue(data.modulename),
    course_id: numberValue(course.id),
    course_name: stringValue(course.fullname),
    due_at: numberValue(data.timesort) || numberValue(data.timestart),
    overdue: booleanValue(data.overdue),
    actionable: booleanValue(action.actionable),
    action_name: stringValue(action.name),
    action_url: stringValue(action.url),
    url: stringValue(data.url),
    event_type: stringValue(data.eventtype),
    course_progress: typeof progress === "number" ? progress : void 0
  };
}
function parseTodoItems(value) {
  return asArray(value).map((item) => parseTodoItem(item));
}
function parseAlertNotification(value) {
  const data = asRecord(value);
  return {
    id: numberValue(data.id),
    subject: stringValue(data.subject),
    short_subject: stringValue(data.shortenedsubject),
    event_type: stringValue(data.eventtype),
    component: stringValue(data.component),
    created_at: numberValue(data.timecreated),
    created_pretty: stringValue(data.timecreatedpretty),
    read: booleanValue(data.read),
    context_url: stringValue(data.contexturl),
    context_name: stringValue(data.contexturlname)
  };
}
function parseAlertSummary(notificationsData, countsData, unreadCountsData) {
  const notificationsRecord = asRecord(notificationsData);
  const counts = asRecord(countsData);
  const unreadCounts = asRecord(unreadCountsData);
  const types = asRecord(counts.types);
  const unreadTypes = asRecord(unreadCounts.types);
  const notifications = asArray(notificationsRecord.notifications).map((item) => parseAlertNotification(item));
  return {
    notifications,
    notification_count: notifications.length,
    unread_notification_count: notifications.filter((notification) => !notification.read).length,
    starred_message_count: numberValue(counts.favourites),
    direct_message_count: numberValue(types["1"]),
    group_message_count: numberValue(types["2"]),
    self_message_count: numberValue(types["3"]),
    unread_starred_message_count: numberValue(unreadCounts.favourites),
    unread_direct_message_count: numberValue(unreadTypes["1"]),
    unread_group_message_count: numberValue(unreadTypes["2"]),
    unread_self_message_count: numberValue(unreadTypes["3"])
  };
}
function parseForumPostAuthor(value) {
  const data = asRecord(value);
  const urls = asRecord(data.urls);
  return {
    id: numberValue(data.id),
    fullname: stringValue(data.fullname),
    profile_url: stringValue(urls.profile),
    profile_image_url: stringValue(urls.profileimage)
  };
}
function parseForumPost(value, baseUrl = "") {
  const data = asRecord(value);
  const urls = asRecord(data.urls);
  const messageHtml = stringValue(data.message);
  const structured = htmlToStructuredContent(messageHtml, stringValue(urls.view || urls.discuss) || baseUrl);
  return {
    id: numberValue(data.id),
    discussion_id: numberValue(data.discussionid),
    subject: stringValue(data.subject),
    message_html: messageHtml,
    message_text: structured.text,
    image_urls: structured.image_urls,
    links: structured.links,
    tables: structured.tables,
    author: parseForumPostAuthor(data.author),
    parent_id: numberValue(data.parentid),
    time_created: numberValue(data.timecreated),
    time_modified: numberValue(data.timemodified),
    created_pretty: "",
    unread: booleanValue(data.unread),
    is_deleted: booleanValue(data.isdeleted),
    is_private_reply: booleanValue(data.isprivatereply),
    url: stringValue(urls.view || urls.viewisolated),
    reply_url: stringValue(urls.reply)
  };
}
function parseForumDiscussion(value, discussionId, baseUrl = "") {
  const data = asRecord(value);
  const posts = asArray(data.posts).map((item) => parseForumPost(item, baseUrl));
  return {
    id: discussionId,
    subject: posts[0]?.subject ?? "",
    course_id: numberValue(data.courseid),
    forum_id: numberValue(data.forumid),
    group_id: numberValue(data.groupid),
    group_name: stringValue(data.groupname),
    url: posts[0]?.url ? posts[0].url.split("#", 1)[0] : "",
    posts
  };
}
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function stringValue(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}
function booleanValue(value, defaultValue = false) {
  if (value === void 0 || value === null) {
    return defaultValue;
  }
  return Boolean(value);
}
function parseJsonValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
function htmlText(value, baseUrl) {
  return htmlToStructuredContent(stringValue(value), baseUrl).text;
}

// src/scraper.ts
function parseMoodleErrorHtml(html) {
  const root = parse2(html);
  const messageNode = first(root, [
    ".errormessage",
    ".alert-danger .alert-message",
    "[data-region='error-message']",
    ".alert-danger[role='alert']",
    ".alert-danger"
  ]);
  if (!messageNode) {
    return null;
  }
  const messageRoot = parse2(messageNode.toString());
  for (const unwanted of messageRoot.querySelectorAll(
    "button, .close, .errorcode, .stacktrace, .debuginfo, .backtrace, a.alert-link, a[href*='/error/']"
  )) {
    unwanted.remove();
  }
  const message = cleanText(messageRoot.textContent);
  if (!message) {
    return null;
  }
  const errorCodeText = cleanNodeText(root.querySelector(".errorcode"));
  const errorCode = errorCodeText.match(/^error\s+code\s*:\s*([a-z][a-z0-9_]*)\s*$/iu)?.[1] ?? moodleDocsErrorCode(root);
  return { message, ...errorCode ? { code: errorCode } : {} };
}
function isOtherMoodlePage(html, type, cmid) {
  const instance = numberValue2(parseMoodleConfig(html).contextInstanceId);
  if (instance && instance !== cmid) return true;
  const pageId = parse2(html).querySelector("body")?.getAttribute("id") ?? "";
  return pageId.startsWith("page-") && pageId !== `page-mod-${type}-view`;
}
function parseUnavailableNotice(html) {
  const conditions = parse2(html).querySelector(".availabilityinfo-error");
  return conditions ? blockText(conditions) : parseMoodleErrorHtml(html)?.message ?? "";
}
function parsePageContext(html, baseUrl) {
  const root = parse2(html);
  const config = parseMoodleConfig(html);
  const sesskey = stringValue2(config.sesskey).trim();
  const timezone = moodleTimezone(config.usertimezone || config.timezone);
  const userid = numberValue2(config.userId) || numberValue2(root.querySelector("[data-user-id]")?.getAttribute("data-user-id"));
  if (!sesskey || !userid) {
    throw new Error("Session appears invalid: could not load authenticated Moodle context");
  }
  return {
    sesskey,
    user_info: {
      userid,
      username: "",
      fullname: cleanNodeText(root.querySelector(".userfullname")),
      sitename: extractSitename(root),
      siteurl: baseUrl,
      ...timezone ? { timezone } : {},
      lang: stringValue2(config.language) || root.querySelector("html")?.getAttribute("lang") || ""
    }
  };
}
function moodleTimezone(value) {
  const name = stringValue2(value);
  if (!name) return void 0;
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return name;
  } catch {
    const slash = name.indexOf("/");
    if (slash < 0) return void 0;
    const suffix = name.slice(slash);
    const matches = Intl.supportedValuesOf("timeZone").filter((zone) => zone.slice(zone.indexOf("/")) === suffix);
    return matches.length === 1 ? matches[0] : void 0;
  }
}
function parseCourseContentsHtml(html, baseUrl) {
  const root = parse2(html);
  const sections = [];
  for (const sectionElement of root.querySelectorAll('li[data-for="section"]')) {
    const sectionId = safeInt(sectionElement.getAttribute("data-id"));
    const sectionNumber = safeInt(sectionElement.getAttribute("data-number") ?? sectionElement.getAttribute("data-sectionnum"));
    const positionName = cleanNodeText(sectionElement.querySelector(".course-section-position-name"));
    const mainName = cleanNodeText(
      firstDefined([
        first(sectionElement, ["h1.sectionname", "h2.sectionname", "h3.sectionname"]),
        sectionElement.querySelector('[data-for="section_title"] a'),
        sectionElement.querySelector('[data-for="section_title"]')
      ])
    );
    const name = positionName && mainName && positionName !== mainName ? `${positionName} - ${mainName}` : mainName || positionName || `Section ${sectionNumber}`;
    const visible = !(sectionElement.getAttribute("class") ?? "").split(/\s+/).includes("hidden");
    const activities = [];
    const seenActivities = /* @__PURE__ */ new Set();
    for (const activityElement of sectionElement.querySelectorAll('li[data-for="cmitem"]')) {
      const id = safeInt(activityElement.getAttribute("data-id"));
      if (id && seenActivities.has(id)) {
        continue;
      }
      if (id) {
        seenActivities.add(id);
      }
      const classes = (activityElement.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
      const modname = classes.find((item) => item.startsWith("modtype_"))?.slice("modtype_".length) ?? "";
      const nameNode = firstDefined([
        activityElement.querySelector(".activityname .instancename"),
        activityElement.querySelector(".activityname"),
        activityElement.querySelector("a.aalink")
      ]);
      for (const hidden of nameNode?.querySelectorAll(".accesshide") ?? []) hidden.remove();
      const name2 = cleanNodeText(nameNode);
      if (!name2) {
        continue;
      }
      const href = activityElement.querySelector(".activityname a, a.aalink, a[href]")?.getAttribute("href") ?? "";
      activities.push({
        id,
        name: name2,
        modname,
        url: href ? resolveUrl(baseUrl, href) : "",
        // An activity the account cannot open yet is listed without a link and with the
        // restriction beside it. Labels and subsections have no link either but can be read.
        // The contents service calls this uservisible.
        visible: !classes.some((item) => ["hidden", "stealth", "dimmed"].includes(item)) && (Boolean(href) || !activityElement.querySelector(".availabilityinfo")),
        description: cleanNodeText(first(activityElement, ["[data-region='activity-description']", ".contentafterlink", ".description"]))
      });
    }
    sections.push({
      id: sectionId,
      name,
      section: sectionNumber,
      visible,
      summary: cleanNodeText(first(sectionElement, [".summarytext", "[data-for='sectioninfo']"])),
      activities
    });
  }
  return sections;
}
function parseCourseSectionNumbers(html, courseId) {
  const sections = [];
  const root = parse2(html.replace(/&section=/gu, "&amp;section="));
  const hrefs = root.querySelectorAll('a[href*="/course/view.php"]').map((link) => link.getAttribute("href") ?? "");
  for (const href of hrefs) {
    const url = parseMaybeUrl(href.replace(/&amp;/gu, "&"), "https://moodle.invalid");
    const id = url?.searchParams.get("id");
    const sectionValue = url?.searchParams.get("section");
    if (id === String(courseId) && sectionValue && /^\d+$/.test(sectionValue)) {
      const section = Number(sectionValue);
      if (!sections.includes(section)) {
        sections.push(section);
      }
    }
  }
  return sections;
}
function parseCourseGradesUrl(html, baseUrl) {
  const root = parse2(html);
  const link = root.querySelector('li[data-key="grades"] a[href]') ?? root.querySelector('.secondary-navigation a[href*="mode=grade"]') ?? root.querySelector('.secondary-navigation a[href*="/grade/report/"]') ?? root.querySelector('a[href*="mode=grade"], a[href*="/grade/report/"]');
  const href = link?.getAttribute("href") ?? "";
  return href ? resolveUrl(baseUrl, href) : "";
}
function parseCourseIdFromPageHtml(html) {
  const root = parse2(html);
  for (const link of root.querySelectorAll('a[href*="/course/view.php?id="]')) {
    const courseId = numberQueryValue(link.getAttribute("href") ?? "", "id");
    if (courseId !== null) {
      return courseId;
    }
  }
  return null;
}
function hasCourseGradesHtml(html) {
  return parse2(html).querySelector("table.user-grade") !== null;
}
function parseCourseGradesHtml(html, courseId, baseUrl) {
  const root = parse2(html);
  const report = {
    course_id: courseId,
    course_name: cleanNodeText(root.querySelector("h1")),
    learner_name: cleanNodeText(
      firstDefined([
        root.querySelector(".grade-report-user .page-header-headings h2"),
        root.querySelector(".page-header-headings h2"),
        root.querySelector(".grade-report-user h2 a"),
        root.querySelector("h2 a"),
        root.querySelector("h2")
      ])
    ),
    total_grade: "",
    total_range: "",
    total_percentage: "",
    items: []
  };
  const table = root.querySelector("table.user-grade");
  if (!table) {
    return report;
  }
  for (const row of table.querySelectorAll("tr")) {
    const title = cleanNodeText(row.querySelector(".rowtitle"));
    if (!title || row.querySelector(".toggle-category")) {
      continue;
    }
    if (title === "Course total") {
      report.total_grade = cleanTableCell(row.querySelector("td.column-grade"));
      report.total_range = cleanTableCell(row.querySelector("td.column-range"));
      report.total_percentage = cleanTableCell(row.querySelector("td.column-percentage"));
      continue;
    }
    const link = row.querySelector(".rowtitle a.gradeitemheader, .rowtitle a");
    if (!link) {
      continue;
    }
    const statusIcon = row.querySelector("td.column-grade i[aria-label], td.column-grade i[title]");
    const item = parseGradeItem({
      name: title,
      item_type: cleanText(row.querySelector(".item img.itemicon, .courseitem img.itemicon, img.itemicon")?.getAttribute("alt") ?? ""),
      grade: cleanTableCell(row.querySelector("td.column-grade")),
      range: cleanTableCell(row.querySelector("td.column-range")),
      percentage: cleanTableCell(row.querySelector("td.column-percentage")),
      weight: cleanTableCell(row.querySelector("td.column-weight")),
      contribution: cleanTableCell(row.querySelector("td.column-contributiontocoursetotal")),
      feedback: cleanTableCell(row.querySelector("td.column-feedback")),
      url: resolveUrl(baseUrl, link.getAttribute("href") ?? ""),
      status: statusIcon?.getAttribute("aria-label") ?? statusIcon?.getAttribute("title") ?? ""
    });
    report.items.push(item);
  }
  return report;
}
function parseGradeOverviewRows(html, baseUrl) {
  const rows = {};
  const table = parse2(html).querySelector("table#overview-grade");
  if (!table) {
    return rows;
  }
  for (const row of table.querySelectorAll("tbody tr, tr")) {
    const link = row.querySelector("td a[href]");
    if (!link) {
      continue;
    }
    const href = resolveUrl(baseUrl, link.getAttribute("href") ?? "");
    const courseId = numberQueryValue(href, "id");
    if (courseId === null) {
      continue;
    }
    const cells = row.querySelectorAll("td");
    rows[courseId] = {
      course_name: cleanNodeText(link),
      grade: cleanNodeText(cells[1]),
      url: href
    };
  }
  return rows;
}
function parseAssignmentHtml(html, assignmentId, baseUrl, labels) {
  const root = parse2(html);
  const feedback = root.querySelector(".feedback");
  return {
    id: assignmentId,
    name: pageTitle(html),
    ...activityContext(html),
    due_pretty: extractLabeledText(html, "Due:", labels),
    submission_status: findTableValue(html, "Submission status", labels),
    grading_status: findTableValue(html, "Grading status", labels),
    time_remaining: findTableValue(html, "Time remaining", labels),
    grade: findTableValue(html, "Grade", labels),
    graded_on: feedback ? findTableValue(feedback.toString(), "Graded on", labels) : "",
    graded_by: feedback ? findTableValue(feedback.toString(), "Graded by", labels) : "",
    feedback_comments: feedback ? findTableValue(feedback.toString(), "Feedback comments", labels) : "",
    criteria: feedback ? parseFeedbackCriteria(feedback) : [],
    file_entries: [...parseIntroAttachments(root, baseUrl), ...feedback ? parseFeedbackFiles(feedback, baseUrl) : []],
    url: `${baseUrl.replace(/\/$/, "")}/mod/assign/view.php?id=${assignmentId}`
  };
}
function parseFeedbackCriteria(feedback) {
  const criteria = [];
  for (const row of feedback.querySelectorAll("tr.criterion")) {
    const level = row.querySelector("td.level.checked");
    const name = cleanNodeText(row.querySelector(".criterionshortname") ?? row.querySelector("td.description"));
    if (!name) continue;
    criteria.push({
      name,
      level: cleanNodeText(level?.querySelector(".definition")),
      score: cleanNodeText(row.querySelector("td.score") ?? level?.querySelector(".score")),
      remark: cleanTableCell(row.querySelector("td.remark"))
    });
  }
  return criteria;
}
function parseIntroAttachments(root, baseUrl) {
  const entries = [];
  for (const link of root.querySelectorAll('a[href*="/mod_assign/introattachment/"]')) {
    const url = resolveUrl(baseUrl, link.getAttribute("href") ?? "");
    const name = cleanNodeText(link) || decodeURIComponent(new URL(url).pathname.split("/").at(-1) || "file");
    if (!entries.some((entry) => entry.url === url)) entries.push(fileEntry(name, url, baseUrl));
  }
  return entries;
}
function parseFeedbackFiles(feedback, baseUrl) {
  const entries = [];
  for (const link of feedback.querySelectorAll('a[href*="pluginfile.php"]')) {
    const url = resolveUrl(baseUrl, link.getAttribute("href") ?? "");
    const label = cleanNodeText(link);
    const name = /\.\w{1,5}$/u.test(label) ? label : decodeURIComponent(new URL(url).pathname.split("/").at(-1) || "file");
    if (!entries.some((entry) => entry.url === url)) entries.push(fileEntry(name, url, baseUrl));
  }
  return entries;
}
function parseQuizHtml(html, quizId, baseUrl, labels) {
  const root = parse2(html);
  return {
    id: quizId,
    name: pageTitle(html),
    ...activityContext(html),
    opens_pretty: extractLabeledText(html, "Opens:", labels),
    closes_pretty: extractLabeledText(html, "Closes:", labels),
    attempts_allowed: labeledParagraph(root, "Attempts allowed:", labels),
    time_limit: labeledParagraph(root, "Time limit:", labels),
    availability: cleanText(root.textContent.match(/This quiz is currently[^\n]+/i)?.[0] ?? ""),
    grade: findTableValue(html, "Grade", labels),
    attempts: parseQuizAttempts(root, baseUrl, labels),
    url: `${baseUrl.replace(/\/$/, "")}/mod/quiz/view.php?id=${quizId}`
  };
}
function labeledParagraph(root, label, labels) {
  const prefixes = labelTexts(label, labels).map((text) => text.replace(/\s*[:：]$/u, ""));
  for (const p of root.querySelectorAll("p")) {
    const line = cleanNodeText(p);
    for (const prefix of prefixes) {
      if (line.toLowerCase().startsWith(prefix.toLowerCase())) return cleanText(line.slice(prefix.length).replace(/^\s*[:：]/u, ""));
    }
  }
  return "";
}
function parseQuizAttempts(root, baseUrl, labels) {
  const attempts = [];
  for (const table of root.querySelectorAll("table.quizreviewsummary")) {
    const card = table.closest(".card") ?? table.parentNode;
    const link = card?.querySelector('a[href*="/mod/quiz/review.php"]');
    const reviewUrl = link ? resolveUrl(baseUrl, link.getAttribute("href") ?? "") : "";
    const id = numberQueryValue(reviewUrl, "attempt");
    if (!link || id === null) continue;
    const summary = labelled(tableValues(table), labels);
    const number = Number(cleanNodeText(card?.querySelector(".card-title")).match(/\d+/)?.[0] ?? attempts.length + 1);
    attempts.push({ id, number, status: summary("Status"), started: summary("Started"), completed: summary("Completed"), duration: summary("Duration"), marks: summary("Marks"), grade: summary("Grade"), review_url: reviewUrl });
  }
  return attempts;
}
function parseQuizReviewHtml(html, attemptId, baseUrl, labels) {
  const root = parse2(html);
  const summary = labelled(tableValues(root.querySelector("table.quizreviewsummary")), labels);
  const form = root.querySelector("form.questionflagsaveform");
  const url = `${baseUrl.replace(/\/$/, "")}/mod/quiz/review.php?attempt=${attemptId}`;
  return {
    id: attemptId,
    quiz_id: numberQueryValue(form?.getAttribute("action") ?? "", "cmid") ?? 0,
    course_id: parseCourseIdFromPageHtml(html) ?? 0,
    status: summary("Status"),
    started: summary("Started"),
    completed: summary("Completed"),
    duration: summary("Duration"),
    marks: summary("Marks"),
    grade: summary("Grade"),
    questions: root.querySelectorAll("div.que").map(parseQuizQuestion),
    url
  };
}
function parseQuizQuestion(que) {
  const answer = que.querySelector(".answer");
  const picked = answer?.querySelectorAll("input:checked, input[checked]").map((input) => {
    const label = input.getAttribute("aria-labelledby");
    return cleanTableCell(label ? que.querySelector(`[id="${label}"]`) : input.parentNode);
  }).filter(Boolean) ?? [];
  const typed = cleanText(que.querySelector('input[type="text"], input[type="number"]')?.getAttribute("value") ?? "");
  const response = picked.length ? picked.join("; ") : typed || blockText(answer?.querySelector(".qtype_essay_response") ?? answer);
  return {
    number: Number(cleanNodeText(que.querySelector(".qno")) || 0),
    type: que.classList.value[1] ?? "",
    state: cleanNodeText(que.querySelector(".info .state")),
    mark: cleanNodeText(que.querySelector(".info .grade")).replace(/^Mark\s+/u, ""),
    text: blockText(que.querySelector(".qtext")),
    response: response.replace(/\s*Word count: \d+$/u, ""),
    correct: blockText(que.querySelector(".rightanswer")).replace(/^The correct answers? (?:is|are):?\s*/iu, "").replace(/^'(.*)'\.?$/u, "$1"),
    feedback: blockText(que.querySelector(".outcome .feedback"))
  };
}
function blockText(node) {
  if (!node) return "";
  return cleanTableCell(parse2(node.toString().replace(/<br\s*\/?>|<\/(?:p|div|li|h\d|tr)>/giu, "$& ")));
}
function labelled(values, labels) {
  const byKey = new Map(Object.entries(values).map(([key, value]) => [labelKey(key), value]));
  return (label) => labelTexts(label, labels).map((text) => byKey.get(labelKey(text))).find((value) => value !== void 0) ?? "";
}
function tableValues(table) {
  const values = {};
  for (const row of table?.querySelectorAll("tr") ?? []) {
    const cells = row.querySelectorAll("th, td");
    if (cells.length >= 2) values[cleanNodeText(cells[0])] = cleanTableCell(cells[1]);
  }
  return values;
}
function parseResourceHtml(html, resourceId, baseUrl) {
  const root = parse2(html);
  const link = root.querySelector(".resourceworkaround a[href], .resourcecontent a[href], a.resourceworkaround[href]");
  const embed = root.querySelector(".resourcecontent iframe[src], .resourcecontent object[data], .resourcecontent embed[src]");
  const rawUrl = link?.getAttribute("href") || embed?.getAttribute("src") || embed?.getAttribute("data") || "";
  const targetUrl = rawUrl ? resolveUrl(baseUrl, rawUrl) : "";
  const targetName = cleanNodeText(link) || (targetUrl ? decodeURIComponent(new URL(targetUrl).pathname.split("/").at(-1) || "file") : "");
  return {
    id: resourceId,
    name: pageTitle(html),
    ...activityContext(html),
    target_name: targetName,
    target_url: targetUrl,
    file_entries: targetName && targetUrl ? [fileEntry(targetName, targetUrl, baseUrl)] : [],
    url: `${baseUrl.replace(/\/$/, "")}/mod/resource/view.php?id=${resourceId}`
  };
}
function parseLinkHtml(html, linkId, baseUrl) {
  const root = parse2(html);
  const link = root.querySelector(".urlworkaround a[href], .mod_url-content a[href], .externalurl a[href]");
  return {
    id: linkId,
    name: pageTitle(html),
    ...activityContext(html),
    target_url: link?.getAttribute("href") ?? "",
    url: `${baseUrl.replace(/\/$/, "")}/mod/url/view.php?id=${linkId}`
  };
}
function parsePageHtml(html, pageId, baseUrl) {
  const root = parse2(html);
  const content = first(root, [".box.generalbox", ".activity-description", "[data-region='page-content']", "main"]);
  return {
    id: pageId,
    name: pageTitle(html),
    ...activityContext(html),
    content_text: content ? htmlToStructuredContent(content.innerHTML, baseUrl).text : "",
    url: `${baseUrl.replace(/\/$/, "")}/mod/page/view.php?id=${pageId}`
  };
}
function parseSavedDocumentHtml(html, baseUrl) {
  const root = parse2(html);
  const content = first(root, [".book", "[role='main']", "#region-main"]);
  if (!content || !cleanNodeText(content)) return void 0;
  for (const node of content.querySelectorAll(".book_info, .hidden-print, script, meta, link, noscript")) node.remove();
  for (const node of content.querySelectorAll("*")) {
    for (const name of Object.keys(node.attributes)) {
      if (/^on/iu.test(name)) node.removeAttribute(name);
    }
    for (const name of ["href", "src"]) {
      const value = node.getAttribute(name);
      if (value && !value.startsWith("#") && !value.startsWith("data:")) node.setAttribute(name, resolveUrl(baseUrl, value));
    }
  }
  return content;
}
function parseFolderHtml(html, folderId, baseUrl) {
  const root = parse2(html);
  const fileEntries = root.querySelectorAll(".foldertree a[href], .fp-filename-icon a[href]").map((link) => {
    const name = cleanNodeText(link);
    const url = resolveUrl(baseUrl, link.getAttribute("href") ?? "");
    return name && url ? fileEntry(name, url, baseUrl) : null;
  }).filter((entry) => entry !== null).filter((entry, index, entries) => entries.findIndex((candidate) => candidate.url === entry.url) === index);
  return {
    id: folderId,
    name: pageTitle(html),
    ...activityContext(html),
    files: unique(fileEntries.map((entry) => entry.name)),
    file_entries: fileEntries,
    url: `${baseUrl.replace(/\/$/, "")}/mod/folder/view.php?id=${folderId}`
  };
}
function parseForumDiscussionHtml(html, baseUrl, discussionId) {
  const root = parse2(html);
  let postElements = root.querySelectorAll("div.forumpost[data-post-id]");
  if (!postElements.length) {
    postElements = root.querySelectorAll("article[data-post-id]");
  }
  const [groupId, groupName] = parseForumDiscussionGroupHtml(html);
  const posts = [];
  for (const element of postElements) {
    const postId = safeInt(element.getAttribute("data-post-id"));
    if (!postId) {
      continue;
    }
    const header = first(element, ["header", ".header"]);
    const subject = cleanNodeText(
      firstDefined([
        header ? first(header, ["h3"]) : null,
        first(element, ["h3", "[data-region='post-title']"])
      ])
    );
    const authorLink = firstDefined([
      header ? first(header, ['a[href*="/user/"]']) : null,
      first(element, ['a[href*="/user/"]', 'a[href*="/user/profile.php"]'])
    ]) ?? null;
    const messageElement = first(element, [
      ".post-content-container",
      ".content",
      "[data-region='post-content']",
      "[data-region-content='forum-post-core']"
    ]);
    const messageHtml = messageElement?.innerHTML ?? "";
    const structured = htmlToStructuredContent(messageHtml, baseUrl);
    posts.push({
      id: postId,
      discussion_id: discussionId,
      subject,
      message_html: messageHtml,
      message_text: structured.text,
      image_urls: structured.image_urls,
      links: structured.links,
      tables: structured.tables,
      author: {
        id: 0,
        fullname: cleanNodeText(authorLink),
        profile_url: authorLink ? resolveUrl(baseUrl, authorLink.getAttribute("href") ?? "") : "",
        profile_image_url: ""
      },
      parent_id: 0,
      time_created: 0,
      time_modified: 0,
      created_pretty: cleanNodeText(header ? first(header, [".date", "time"]) : null),
      unread: false,
      is_deleted: false,
      is_private_reply: false,
      url: `${baseUrl.replace(/\/$/, "")}/mod/forum/discuss.php?d=${discussionId}#p${postId}`,
      reply_url: `${baseUrl.replace(/\/$/, "")}/mod/forum/post.php?reply=${postId}#mformforum`
    });
  }
  return {
    id: discussionId,
    subject: posts[0]?.subject ?? "",
    course_id: 0,
    forum_id: 0,
    group_id: groupId,
    group_name: groupName,
    url: `${baseUrl.replace(/\/$/, "")}/mod/forum/discuss.php?d=${discussionId}`,
    posts
  };
}
function parseForumViewCmidFromDiscussionHtml(html) {
  const root = parse2(html);
  const link = first(root, ['a[href*="/mod/forum/view.php?id="]', 'a[href*="mod/forum/view.php?id="]']);
  const href = link?.getAttribute("href") ?? "";
  if (!href) {
    return null;
  }
  const url = parseMaybeUrl(href, "https://moodle.invalid");
  if (!url || !url.pathname.endsWith("/mod/forum/view.php")) {
    return null;
  }
  return numericQueryValue(url, "id");
}
function parseForumDiscussionRefsHtml(html, baseUrl) {
  const root = parse2(html);
  const refs = [];
  const seen = /* @__PURE__ */ new Set();
  const links = [
    ...root.querySelectorAll('a[href*="/mod/forum/discuss.php?d="]'),
    ...root.querySelectorAll('a[href*="mod/forum/discuss.php?d="]'),
    ...root.querySelectorAll('a[href*="discuss.php?d="]')
  ];
  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    const url = parseMaybeUrl(href, baseUrl);
    if (!url || !url.pathname.endsWith("/mod/forum/discuss.php")) {
      continue;
    }
    const discussionId = numericQueryValue(url, "d");
    if (!discussionId || seen.has(discussionId)) {
      continue;
    }
    const subject = cleanNodeText(link);
    if (!subject || ["permalink", "discuss"].includes(subject.toLowerCase())) {
      continue;
    }
    seen.add(discussionId);
    refs.push({
      id: discussionId,
      subject,
      group_id: 0,
      group_name: "",
      url: resolveUrl(baseUrl, href)
    });
  }
  return refs;
}
function parseForumGroupsHtml(html) {
  const root = parse2(html);
  const select = first(root, ["form#selectgroup select[name='group']", "select[name='group']"]);
  if (!select) {
    return [];
  }
  const groups = [];
  const seen = /* @__PURE__ */ new Set();
  for (const option2 of select.querySelectorAll("option")) {
    const groupId = safeInt(option2.getAttribute("value"));
    if (!groupId) {
      continue;
    }
    const groupName = cleanNodeText(option2);
    const key = `${groupId}:${groupName}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    groups.push([groupId, groupName]);
  }
  return groups;
}
function parseForumDiscussionGroupHtml(html) {
  const root = parse2(html);
  const groupId = safeInt(root.querySelector("form#mformforum input[name='groupid']")?.getAttribute("value"));
  return [groupId, selectedGroupName(root, groupId)];
}
function selectedGroupName(root, groupId) {
  if (groupId <= 0) {
    return "";
  }
  for (const selector of ["select[name='groupinfo']", "select[name='group']"]) {
    const option2 = root.querySelector(selector)?.querySelector(`option[value='${groupId}']`) ?? null;
    if (option2) {
      return cleanNodeText(option2);
    }
  }
  return "";
}
function moodleDocsErrorCode(root) {
  for (const link of root.querySelectorAll("a[href*='/error/']")) {
    const href = link.getAttribute("href") ?? "";
    const code = href.match(/\/error\/[^/]+\/([a-z][a-z0-9_]*)/iu)?.[1];
    if (code) {
      return code;
    }
  }
  return void 0;
}
function cleanNodeText(node) {
  return cleanText(node?.textContent ?? "");
}
function first(root, selectors) {
  for (const selector of selectors) {
    const match = root.querySelector(selector);
    if (match) {
      return match;
    }
  }
  return null;
}
function firstDefined(items) {
  return items.find((item) => item !== null && item !== void 0) ?? null;
}
function safeInt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return 0;
}
function parseMaybeUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl);
  } catch {
    return null;
  }
}
function numericQueryValue(url, key) {
  const value = url.searchParams.get(key);
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}
function parseMoodleConfig(html) {
  const match = html.match(/M\.cfg\s*=\s*({[\s\S]*?});/);
  if (!match) {
    return {};
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}
function extractSitename(root) {
  const title = cleanNodeText(root.querySelector("title"));
  return title.includes("|") ? title.split("|").at(-1)?.trim() ?? title : title;
}
function pageTitle(html) {
  const root = parse2(html);
  const heading = cleanNodeText(root.querySelector("h1"));
  const main = cleanNodeText(root.querySelector("#region-main h2"));
  const title = cleanNodeText(root.querySelector("title"));
  const separator = title.lastIndexOf(" | ");
  const named2 = separator < 0 ? title : title.slice(0, separator);
  if (main && endIn(named2, main) > endIn(named2, heading)) return main;
  return heading || main;
}
function endIn(text, part) {
  const at = part ? text.lastIndexOf(part) : -1;
  return at < 0 ? -1 : at + part.length;
}
function activityContext(html) {
  const root = parse2(html);
  const context = { course_id: parseCourseIdFromPageHtml(html) ?? 0, course_name: "", section_name: "" };
  const breadcrumbs = root.querySelectorAll('nav[aria-label="Breadcrumb"] a[href], #page-navbar .breadcrumb a[href]');
  const links = breadcrumbs.length ? breadcrumbs : root.querySelectorAll('a[href*="/course/view.php?id="]');
  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    const sectionPage = /\/course\/section\.php\b/u.test(href);
    const courseId = /\/course\/view\.php\b/u.test(href) ? numberQueryValue(href, "id") : null;
    if (courseId !== null) {
      context.course_id = courseId;
    }
    if (sectionPage || numberQueryValue(href, "section") !== null) {
      context.section_name = cleanNodeText(link);
    } else if (courseId !== null) {
      context.course_name ||= cleanNodeText(link);
    }
  }
  return context;
}
function extractLabeledText(html, label, labels) {
  const root = parse2(html);
  const wanted = new Set(labelTexts(label, labels).map(labelKey));
  for (const node of root.querySelectorAll("strong, b")) {
    const text = cleanNodeText(node);
    if (!wanted.has(labelKey(text))) {
      continue;
    }
    const parent = node.parentNode;
    return cleanText(parent?.textContent.replace(text, "") ?? "");
  }
  return "";
}
function findTableValue(html, label, labels) {
  const root = parse2(html);
  const wanted = new Set(labelTexts(label, labels).map(labelKey));
  for (const row of root.querySelectorAll("tr")) {
    const cells = row.querySelectorAll("th, td");
    if (wanted.has(labelKey(cleanNodeText(cells[0])))) {
      return cleanTableCell(cells[1]);
    }
  }
  return "";
}
function cleanTableCell(node) {
  if (!node) {
    return "";
  }
  const clone = parse2(node.toString());
  for (const unwanted of clone.querySelectorAll(".action-menu, .dropdown, .hidden, .accesshide, .userinitials, script, style")) {
    unwanted.remove();
  }
  return cleanText(clone.textContent.replace("( Empty )", "(Empty)"));
}
function numberQueryValue(href, key) {
  try {
    return numericQueryValue(new URL(href, "https://moodle.invalid"), key);
  } catch {
    return null;
  }
}
function numberValue2(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}
function stringValue2(value) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function fileEntry(name, url, baseUrl) {
  return {
    name,
    url,
    requires_authentication: new URL(url).origin === new URL(baseUrl).origin
  };
}
function unique(items) {
  return [...new Set(items)];
}

// src/moodle-assign-core.ts
async function submitAssignmentFiles(deps, request) {
  const id = request.activityId;
  if (!Number.isSafeInteger(id) || id <= 0) throw deps.usage("The assignment id must be a positive integer.");
  if (!request.files.length && !request.final) throw deps.usage("Give at least one file to upload, or use --final to submit the existing draft.");
  if (!request.files.length && request.replace) throw deps.usage("--replace with no files would empty the submission.", "Give the files that should replace the current ones.");
  const seen = /* @__PURE__ */ new Set();
  for (const file of request.files) {
    if (!file.name || /[\\/]/u.test(file.name)) throw deps.usage(`'${file.name}' is not a plain file name.`);
    if (seen.has(file.name.toLowerCase())) throw deps.usage(`'${file.name}' is given twice; Moodle keeps one file per name.`);
    seen.add(file.name.toLowerCase());
  }
  const viewUrl = `${deps.baseUrl}${ASSIGN_VIEW_PATH}?id=${id}`;
  request.onProgress?.("Reading the assignment");
  const viewHtml = await pageText(deps, viewUrl);
  const before = parseReceiptPage(viewHtml, id, deps.baseUrl);
  const form = parseSubmissionForm(await pageText(deps, `${viewUrl}&action=editsubmission`), deps);
  const draft = await listDraftFiles(deps, form);
  const removed = request.replace ? draft.map((file) => file.name) : [];
  const kept = request.replace ? [] : draft.filter((file) => !seen.has(file.name.toLowerCase()));
  checkLimits(deps, form, kept, request.files);
  const confirmHtml = form.statement ? void 0 : await pageText(deps, `${viewUrl}&action=submit`);
  const draftStage = draftStageOf(viewHtml, before.submission_status, form, confirmHtml);
  if (draftStage !== true && !request.final) {
    throw deps.usage(
      draftStage === false ? "This assignment has no draft stage: Moodle submits it for grading as soon as the files are saved." : "Moodle does not show whether this assignment keeps drafts, so saving the files may submit it for grading at once.",
      "Nothing was uploaded. Re-run with --final only if you want it submitted for grading now; to keep working, upload later."
    );
  }
  let statement = form.statement;
  let confirm;
  if (request.final && draftStage !== false && confirmHtml !== void 0) {
    confirm = parseConfirmForm(confirmHtml, deps);
    statement = confirm.statement;
  }
  if (statement && !request.acceptStatement) {
    throw deps.usage(`Moodle requires you to accept this statement: "${statement}"`, "Re-run with --accept-statement once you agree.");
  }
  const limits = describeLimits(form);
  const uploads = request.files.map((file) => ({ name: file.name, bytes: file.bytes.byteLength, ...file.path ? { path: file.path } : {} }));
  if (request.dryRun) {
    return {
      ...before,
      action: "planned",
      ...draftStage === void 0 ? {} : { draft_stage: draftStage },
      files: draft.map((file) => ({ name: file.name, bytes: file.bytes })),
      uploads,
      removed,
      limits,
      ...statement ? { statement, statement_accepted: true } : {},
      checked_at: timestamp(deps)
    };
  }
  if (removed.length) {
    request.onProgress?.(`Removing ${removed.join(", ")}`);
    await deleteDraftFiles(deps, form, draft);
  }
  const storedNames = [];
  for (const [index, file] of request.files.entries()) {
    request.onProgress?.(`Uploading ${file.name} (${index + 1}/${request.files.length})`);
    storedNames.push(await uploadDraftFile(deps, form, file));
  }
  if (storedNames.length || removed.length) {
    request.onProgress?.("Saving the submission");
    const savedHtml = await postForm(deps, form.action, [...form.fields, ...form.statement ? [["submissionstatement", "1"]] : [], ["submitbutton", "Save changes"]]);
    if (savedHtml !== null) throw deps.fail(`Moodle did not save the submission: ${noticesOf(savedHtml) || "it returned the edit form again without a reason"}`);
  }
  request.onProgress?.("Reading the receipt");
  let receipt = parseReceiptPage(await pageText(deps, viewUrl), id, deps.baseUrl);
  const listed = new Set(receipt.files.map((file) => file.name.toLowerCase()));
  const missing = storedNames.filter((name) => !listed.has(name.toLowerCase()));
  if (missing.length) throw deps.fail(`Moodle saved the submission but its page does not list ${missing.join(", ")}; check the assignment in a browser before submitting.`);
  let action = "saved";
  if (isSubmitted(receipt.submission_status) && !request.final) {
    throw deps.fail(`Moodle submitted the assignment for grading when the files were saved, although its pages showed a draft stage. It now reports "${receipt.submission_status}"; check it in a browser.`);
  }
  if (isSubmitted(receipt.submission_status)) action = "submitted";
  else if (request.final) {
    request.onProgress?.("Submitting for grading");
    confirm ??= parseConfirmForm(await pageText(deps, `${viewUrl}&action=submit`), deps);
    const errorHtml = await postForm(deps, confirm.action, [...confirm.fields, ...confirm.statement ? [["submissionstatement", "1"]] : [], ["submitbutton", "Continue"]]);
    if (errorHtml !== null) throw deps.fail(`Moodle did not submit the assignment for grading: ${noticesOf(errorHtml) || "it returned the confirmation page again without a reason"}`);
    receipt = parseReceiptPage(await pageText(deps, viewUrl), id, deps.baseUrl);
    if (!isSubmitted(receipt.submission_status) && !receipt.awaiting?.length) throw deps.fail(`Moodle accepted the confirmation but still reports "${receipt.submission_status || "no status"}"; check the assignment in a browser.`);
    action = "submitted";
  }
  return {
    ...receipt,
    action,
    ...draftStage === void 0 ? {} : { draft_stage: draftStage },
    uploads,
    removed,
    limits,
    ...statement ? { statement, statement_accepted: true } : {},
    checked_at: timestamp(deps)
  };
}
function parseSubmissionForm(html, deps) {
  const root = parse3(html);
  const form = formWithAction(root, "savesubmission");
  if (!form) {
    const notice = noticesOf(html);
    if (root.querySelectorAll("input[type=submit], button").some((button) => /begin assignment/iu.test(cleanText(button.getAttribute("value") ?? button.textContent)))) {
      throw deps.fail("This is a timed assignment; start it in a browser before uploading files.");
    }
    throw deps.fail(notice ? `Moodle is not accepting a submission: ${notice}` : "Moodle did not show a submission form for this assignment.");
  }
  const itemid = form.querySelector("input[name=files_filemanager]")?.getAttribute("value")?.trim() ?? "";
  if (!itemid) throw deps.fail("This assignment does not accept file uploads.");
  const options = filemanagerOptions(html, itemid);
  if (!options) throw deps.fail("Moodle did not describe the file upload area for this assignment.");
  const fields = formFields(form);
  const sesskey = fields.find(([name]) => name === "sesskey")?.[1] ?? "";
  if (!sesskey) throw deps.fail("The submission form has no session key.");
  const picker = record(options.filepicker);
  const repositories = (Array.isArray(picker.repositories) ? picker.repositories : Object.values(record(picker.repositories))).map(record);
  const upload = repositories.find((repo) => repo.type === "upload");
  if (!upload || upload.id === void 0) throw deps.fail("The site does not allow direct file uploads for this assignment.");
  return {
    action: resolveUrl(deps.baseUrl, form.getAttribute("action") || `${deps.baseUrl}${ASSIGN_VIEW_PATH}`),
    fields,
    sesskey,
    itemid,
    clientId: String(options.client_id ?? ""),
    contextId: String(record(options.context).id ?? ""),
    repoId: String(upload.id),
    author: String(picker.author ?? ""),
    license: String(picker.defaultlicense ?? ""),
    maxBytes: integer(options.maxbytes),
    areaMaxBytes: integer(options.areamaxbytes),
    maxFiles: integer(options.maxfiles),
    acceptedTypes: acceptedTypesOf(options.accepted_types),
    ...statementOf(form)
  };
}
function parseConfirmForm(html, deps) {
  const root = parse3(html);
  const form = formWithAction(root, "confirmsubmit");
  if (!form) {
    const notice = noticesOf(html);
    throw deps.fail(notice ? `Moodle is not accepting a submission for grading: ${notice}` : "Moodle did not show the submit-for-grading confirmation.");
  }
  return { action: resolveUrl(deps.baseUrl, form.getAttribute("action") || `${deps.baseUrl}${ASSIGN_VIEW_PATH}`), fields: formFields(form), ...statementOf(form) };
}
function parseReceiptPage(html, activityId, baseUrl) {
  const page = parseAssignmentHtml(html, activityId, baseUrl);
  const root = parse3(html);
  const files = /* @__PURE__ */ new Map();
  const add = (link) => {
    const name = cleanText(link.textContent);
    const href = link.getAttribute("href") ?? "";
    if (name && !files.has(name.toLowerCase())) files.set(name.toLowerCase(), { name, ...href ? { url: resolveUrl(baseUrl, href) } : {} });
  };
  for (const link of root.querySelectorAll(".fileuploadsubmission a[href]")) add(link);
  for (const link of tableCell(root, "File submissions")?.querySelectorAll("a[href]") ?? []) add(link);
  const groupCell = tableCell(root, "Group");
  const group = groupCell && !groupCell.querySelector(".alert") ? cleanText(groupCell.textContent) : "";
  const pending = tableCell(root, "Submission status")?.querySelectorAll("div").find((div) => /^Users who need to submit:/iu.test(cleanText(div.textContent)));
  const awaiting = pending?.querySelectorAll("a").map((link) => cleanText(link.textContent)).filter(Boolean) ?? [];
  return {
    id: activityId,
    name: page.name,
    ...page.course_id ? { unit_id: page.course_id } : {},
    url: page.url,
    ...group ? { group } : {},
    ...awaiting.length ? { awaiting } : {},
    submission_status: page.submission_status.replace(/\s*Users who need to submit:.*$/isu, ""),
    grading_status: page.grading_status,
    due: page.due_pretty || cleanText(tableCell(root, "Due date")?.textContent),
    time_remaining: page.time_remaining,
    last_modified: cleanText(tableCell(root, "Last modified")?.textContent),
    files: [...files.values()]
  };
}
function draftStageOf(viewHtml, status, form, confirmHtml) {
  if (form.statement) return false;
  const confirm = confirmHtml === void 0 ? null : formWithAction(parse3(confirmHtml), "confirmsubmit");
  if (confirm && statementOf(confirm).statement) return true;
  if (formWithAction(parse3(viewHtml), "submit")) return true;
  if (isSubmitted(status)) return false;
  return void 0;
}
function noticesOf(html) {
  const root = parse3(html);
  const texts = [];
  for (const node of root.querySelectorAll(".alert, .invalid-feedback, .form-control-feedback, .error, [data-fieldtype] .text-danger")) {
    for (const junk of node.querySelectorAll("button, .close")) junk.remove();
    const text = cleanText(node.textContent);
    if (text && !texts.includes(text)) texts.push(text);
  }
  return texts.join(" ");
}
function formWithAction(root, action) {
  for (const form of root.querySelectorAll("form")) {
    if (form.querySelectorAll("input[name=action]").some((input) => input.getAttribute("value") === action)) return form;
  }
  return null;
}
function formFields(form) {
  const fields = [];
  for (const element of form.querySelectorAll("input, textarea, select")) {
    const name = element.getAttribute("name");
    if (!name) continue;
    const tag = element.tagName.toLowerCase();
    if (tag === "textarea") {
      fields.push([name, element.textContent]);
      continue;
    }
    if (tag === "select") {
      const options = element.querySelectorAll("option");
      const chosen = options.find((option2) => option2.hasAttribute("selected")) ?? options[0];
      if (chosen) fields.push([name, chosen.getAttribute("value") ?? cleanText(chosen.textContent)]);
      continue;
    }
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (["submit", "button", "image", "file", "reset"].includes(type)) continue;
    if ((type === "checkbox" || type === "radio") && !element.hasAttribute("checked")) continue;
    fields.push([name, element.getAttribute("value") ?? (type === "checkbox" ? "on" : "")]);
  }
  return fields;
}
function statementOf(form) {
  const box = form.querySelector("input[name=submissionstatement]");
  if (!box) return {};
  const id = box.getAttribute("id");
  const label = (id ? form.querySelector(`label[for="${id}"]`) : null) ?? box.closest("label") ?? box.parentNode?.querySelector("label") ?? null;
  const text = cleanText(label?.textContent).replace(/\s*Required\s*$/u, "").trim();
  return { statement: text || "Submission statement" };
}
function filemanagerOptions(html, itemid) {
  const pattern = /M\.form_filemanager\.init\(\s*Y\s*,\s*/gu;
  let match;
  while (match = pattern.exec(html)) {
    const json = balancedObject(html, match.index + match[0].length);
    if (!json) continue;
    try {
      const options = JSON.parse(json);
      if (isRecord(options) && String(options.itemid) === itemid) return options;
    } catch {
    }
  }
  return null;
}
function acceptedTypesOf(value) {
  const list = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : value === void 0 ? [] : [value];
  const types = list.map((type) => String(type).trim()).filter(Boolean);
  return types.length === 0 || types.includes("*") ? "*" : types;
}
function balancedObject(text, start) {
  if (text[start] !== "{") return null;
  let depth = 0;
  let quoted = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\\") index += 1;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}
function tableCell(root, label) {
  for (const row of root.querySelectorAll("tr")) {
    const cells = row.querySelectorAll("th, td");
    if (cells.length > 1 && cleanText(cells[0].textContent) === label) return cells[1];
  }
  return null;
}
async function pageText(deps, url) {
  return (await deps.request(url)).text();
}
async function postForm(deps, action, fields) {
  const response = await deps.request(action, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString()
  });
  const html = await response.text();
  return landedOnView(response.url) ? null : html;
}
function landedOnView(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.endsWith(ASSIGN_VIEW_PATH) && (parsed.searchParams.get("action") ?? "view") === "view";
  } catch {
    return false;
  }
}
async function draftAjax(deps, form, action, params) {
  const body = new URLSearchParams({ sesskey: form.sesskey, client_id: form.clientId, itemid: form.itemid, ...params });
  const response = await deps.request(`${deps.baseUrl}/repository/draftfiles_ajax.php?action=${action}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  }, { allowErrorStatus: true });
  return jsonOf(deps, response, `draft file ${action}`);
}
async function listDraftFiles(deps, form) {
  const data = record(await draftAjax(deps, form, "list", { filepath: "/" }));
  const list = Array.isArray(data.list) ? data.list.map(record) : [];
  return list.filter((item) => item.type !== "folder").map((item) => ({ name: String(item.filename ?? item.fullname ?? ""), path: String(item.filepath ?? "/"), bytes: integer(item.size) })).filter((item) => item.name);
}
async function deleteDraftFiles(deps, form, files) {
  const selected = JSON.stringify(files.map((file) => ({ filename: file.name, filepath: file.path })));
  const result = await draftAjax(deps, form, "deleteselected", { selected });
  if (result === false) throw deps.fail("Moodle did not remove the existing submission files.");
}
async function uploadDraftFile(deps, form, file) {
  const body = new FormData();
  body.set("sesskey", form.sesskey);
  body.set("client_id", form.clientId);
  body.set("repo_id", form.repoId);
  body.set("itemid", form.itemid);
  body.set("env", "filemanager");
  body.set("ctx_id", form.contextId);
  body.set("title", file.name);
  body.set("author", form.author);
  body.set("license", form.license);
  body.set("savepath", "/");
  body.set("maxbytes", String(form.maxBytes));
  body.set("areamaxbytes", String(form.areaMaxBytes));
  for (const type of form.acceptedTypes === "*" ? ["*"] : form.acceptedTypes) body.append("accepted_types[]", type);
  body.set("overwrite", "1");
  body.set("repo_upload_file", new Blob([Uint8Array.from(file.bytes)]), file.name);
  const response = await deps.request(`${deps.baseUrl}/repository/repository_ajax.php?action=upload`, { method: "POST", body }, { allowErrorStatus: true });
  const data = record(await jsonOf(deps, response, `upload of ${file.name}`));
  if (typeof data.error === "string" && data.error) throw deps.fail(`Moodle refused ${file.name}: ${data.error}`, typeof data.errorcode === "string" ? data.errorcode : void 0);
  if (data.event === "fileexists") throw deps.fail(`Moodle reports ${file.name} already exists and did not overwrite it.`);
  const stored = typeof data.file === "string" && data.file ? data.file : file.name;
  if (!data.url && !data.id && !data.file) throw deps.fail(`Moodle did not confirm the upload of ${file.name}.`);
  return stored;
}
async function jsonOf(deps, response, step) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const notice = noticesOf(text);
    throw deps.fail(`Moodle did not answer the ${step} with JSON (HTTP ${response.status})${notice ? `: ${notice}` : ""}`);
  }
}
function checkLimits(deps, form, kept, files) {
  if (form.maxFiles > 0 && kept.length + files.length > form.maxFiles) {
    throw deps.usage(`This assignment allows ${form.maxFiles} file${form.maxFiles === 1 ? "" : "s"}; the submission would hold ${kept.length + files.length}.`, kept.length ? "Use --replace to drop the existing files first." : void 0);
  }
  for (const file of files) {
    if (form.maxBytes > 0 && file.bytes.byteLength > form.maxBytes) throw deps.usage(`${file.name} is ${size(file.bytes.byteLength)}; the limit is ${size(form.maxBytes)}.`);
    if (form.acceptedTypes !== "*" && form.acceptedTypes.every((type) => type.startsWith(".")) && !form.acceptedTypes.some((type) => file.name.toLowerCase().endsWith(type.toLowerCase()))) {
      throw deps.usage(`${file.name} is not an accepted type; allowed: ${form.acceptedTypes.join(", ")}.`);
    }
  }
  const total = kept.reduce((sum, file) => sum + file.bytes, 0) + files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (form.areaMaxBytes > 0 && total > form.areaMaxBytes) throw deps.usage(`The submission would total ${size(total)}; the limit is ${size(form.areaMaxBytes)}.`, kept.length ? "Use --replace to drop the existing files first." : void 0);
}
function describeLimits(form) {
  return {
    ...form.maxBytes > 0 ? { max_bytes: form.maxBytes } : {},
    ...form.maxFiles > 0 ? { max_files: form.maxFiles } : {},
    ...form.areaMaxBytes > 0 ? { area_max_bytes: form.areaMaxBytes } : {},
    ...form.acceptedTypes !== "*" ? { accepted_types: form.acceptedTypes } : {}
  };
}
function isSubmitted(status) {
  return /\bsubmitted\b/iu.test(status) && !/\bnot submitted\b/iu.test(status);
}
function size(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}
function timestamp(deps) {
  return (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
}
function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value) {
  return isRecord(value) ? value : {};
}

// src/moodle-quiz-core.ts
import { parse as parse4 } from "node-html-parser";
async function planQuizStart(deps, quizId) {
  const { viewUrl, viewHtml, root } = await readQuizView(deps, quizId);
  const start = formWithAction2(root, QUIZ_START_PATH);
  if (!start) throw noAttemptButton(deps, root, viewUrl);
  const quiz = parseQuizHtml(viewHtml, quizId, deps.baseUrl);
  const control = start.querySelector("button, input[type=submit]");
  const button = cleanText(control?.getAttribute("value") ?? control?.textContent);
  const cards = root.querySelectorAll("table.quizreviewsummary");
  const inProgress = /continue/iu.test(button) || cards.some((card) => /in progress/iu.test(cleanText(card.textContent)));
  return {
    quiz_id: quizId,
    name: quiz.name,
    action: inProgress ? "continue" : "start",
    time_limit: quiz.time_limit,
    attempts_allowed: quiz.attempts_allowed,
    attempts_used: cards.length,
    grading_method: infoLine(root, "Grading method:"),
    url: viewUrl
  };
}
async function startQuizAttempt(deps, quizId, options = {}) {
  const { viewUrl, root } = await readQuizView(deps, quizId);
  const resume = formWithAction2(root, QUIZ_ATTEMPT_PATH) ?? root.querySelector(`a[href*="${QUIZ_ATTEMPT_PATH}?"]`);
  if (resume) {
    const target = resume.tagName.toLowerCase() === "form" ? `${resolveUrl(deps.baseUrl, resume.getAttribute("action") ?? "")}?${new URLSearchParams(formFields2(resume)).toString()}` : resolveUrl(deps.baseUrl, resume.getAttribute("href") ?? "");
    const attempt = numberParam(target, "attempt");
    if (attempt) return getAttemptPage(deps, attempt, quizId);
  }
  const start = formWithAction2(root, QUIZ_START_PATH);
  if (!start) throw noAttemptButton(deps, root, viewUrl);
  let response = await deps.request(resolveUrl(deps.baseUrl, start.getAttribute("action") ?? ""), postInit(formFields2(start)));
  let html = await response.text();
  if (!onPath(response.url, QUIZ_ATTEMPT_PATH)) {
    const preflight = formWithAction2(parse4(html), QUIZ_START_PATH);
    if (!preflight) throw deps.fail(`Moodle did not start the attempt: ${noticesOf2(html) || "it returned an unexpected page"}`);
    const fields = [...formFields2(preflight).filter(([name]) => name !== "quizpassword"), ["submitbutton", "Start attempt"]];
    if (preflight.querySelector("input[name=quizpassword]")) {
      const password = options.password ? await options.password() : null;
      if (!password) throw deps.usage("This quiz needs its access password to start.", "Run moodle quiz start again at a terminal to be asked for it, or pass --password.");
      fields.push(["quizpassword", password]);
    }
    response = await deps.request(resolveUrl(deps.baseUrl, preflight.getAttribute("action") ?? ""), postInit(fields));
    html = await response.text();
    if (!onPath(response.url, QUIZ_ATTEMPT_PATH)) throw deps.fail(`Moodle did not start the attempt: ${noticesOf2(html) || "it returned the pre-flight form again"}`);
  }
  return withoutForm(parseAttemptPage(html, response.url, deps));
}
async function readQuizView(deps, quizId) {
  if (!Number.isSafeInteger(quizId) || quizId <= 0) throw deps.usage("The quiz id must be a positive integer.");
  const viewUrl = `${deps.baseUrl}${QUIZ_VIEW_PATH}?id=${quizId}`;
  const viewHtml = await pageText2(deps, viewUrl);
  if (/safeexambrowser|Safe Exam Browser/iu.test(viewHtml)) throw deps.usage("This quiz requires the Safe Exam Browser, which the CLI cannot provide.", "Open it in the browser Moodle asks for.");
  return { viewUrl, viewHtml, root: parse4(viewHtml) };
}
function noAttemptButton(deps, root, viewUrl) {
  const reason = cleanText(root.querySelector(".quizattempt, .quizinfo")?.textContent) || "the quiz page shows no attempt button";
  return deps.usage(`Moodle offers no new attempt: ${reason}`, `See ${viewUrl}`);
}
async function getAttemptPage(deps, attemptId, quizId, page, options = {}) {
  const current = await loadCurrentPage(deps, attemptId, quizId);
  if (page === void 0 || page === current.page) return withoutForm(current);
  if (current.navigation_method === "sequential") {
    const hint = `Page ${current.page + 1} is the current page.`;
    if (page < current.page) throw deps.usage(`Page ${page + 1} is locked: this quiz moves forward only.`, hint);
    if (page > current.page + 1) throw deps.usage(`This quiz moves forward one page at a time; the next page is ${current.page + 2}.`, hint);
    if (!options.advance) throw deps.usage(`Opening page ${page + 1} locks page ${current.page + 1} for good: this quiz moves forward only.`, "Confirm moving on first.");
  }
  return withoutForm(await loadAttemptPage(deps, attemptId, quizId, page));
}
async function loadCurrentPage(deps, attemptId, quizId) {
  return loadAttemptPage(deps, attemptId, quizId, 0);
}
async function loadAttemptPage(deps, attemptId, quizId, page) {
  const url = attemptUrl(deps.baseUrl, attemptId, quizId, page);
  const response = await deps.request(url);
  const html = await response.text();
  if (onPath(response.url, QUIZ_REVIEW_PATH)) throw deps.usage(`Attempt ${attemptId} is already finished.`, `Its review is at ${response.url}`);
  if (!onPath(response.url, QUIZ_ATTEMPT_PATH)) throw deps.fail(`Moodle did not show attempt ${attemptId}: ${noticesOf2(html) || "it redirected elsewhere"}`);
  return parseAttemptPage(html, response.url, deps);
}
function withoutForm({ form: _form, ...page }) {
  return page;
}
async function answerQuizQuestion(deps, request) {
  const first2 = await loadCurrentPage(deps, request.attemptId, request.quizId);
  const entry = first2.navigation.find((item) => item.number === request.question.trim());
  if (!entry) throw deps.usage(`Attempt ${request.attemptId} has no question ${request.question}.`, `Questions: ${first2.navigation.map((item) => item.number).join(", ")}`);
  if (first2.navigation_method === "sequential" && entry.page !== first2.page) {
    throw entry.page < first2.page ? deps.usage(`Question ${request.question} is on page ${entry.page + 1}, which this quiz has locked: it moves forward only.`) : deps.usage(`Question ${request.question} is on page ${entry.page + 1}; this quiz moves forward only and is on page ${first2.page + 1}.`, `Answer page ${first2.page + 1} first, then open page ${first2.page + 2} with moodle quiz show ${request.attemptId} ${request.quizId} --page ${first2.page + 2}; that locks page ${first2.page + 1}.`);
  }
  const page = entry.page === first2.page ? first2 : await loadAttemptPage(deps, request.attemptId, request.quizId, entry.page);
  const question = page.questions.find((item) => item.slot === entry.slot);
  if (!question) throw deps.fail(`Page ${entry.page + 1} does not contain question ${request.question}.`);
  const fields = encodeAnswer(deps, page.form, question, request.value);
  const replay = fields.map(([name, value]) => name === "nextpage" ? [name, String(page.page)] : [name, value]);
  const response = await deps.request(page.form.action, postInit(replay));
  const html = await response.text();
  if (!onPath(response.url, QUIZ_ATTEMPT_PATH)) throw deps.fail(`Moodle did not save the answer: ${noticesOf2(html) || "it left the attempt page"}`);
  const after = parseAttemptPage(html, response.url, deps);
  const saved = after.questions.find((item) => item.slot === question.slot);
  if (!saved || /not yet answered|not answered/iu.test(saved.state)) throw deps.fail(`Moodle accepted the post but still reports question ${request.question} as "${saved?.state || "missing"}".`);
  return withoutForm(after);
}
async function getAttemptSummary(deps, attemptId, quizId) {
  const { form: _form, ...summary } = await loadAttemptSummary(deps, attemptId, quizId);
  return summary;
}
async function loadAttemptSummary(deps, attemptId, quizId) {
  const url = `${deps.baseUrl}${QUIZ_SUMMARY_PATH}?attempt=${attemptId}&cmid=${quizId}`;
  const response = await deps.request(url);
  const html = await response.text();
  if (onPath(response.url, QUIZ_REVIEW_PATH)) throw deps.usage(`Attempt ${attemptId} is already finished.`, `Its review is at ${response.url}`);
  const root = parse4(html);
  const rows = root.querySelectorAll("table.quizsummaryofattempt tbody tr").flatMap((row) => {
    const cells = row.querySelectorAll("td");
    if (cells.length < 2) return [];
    const link = cells[0].querySelector("a")?.getAttribute("href") ?? "";
    return [{ number: cleanText(cells[0].textContent), state: cleanText(cells[1].textContent), page: numberParam(link, "page") ?? 0 }];
  });
  const finish = root.querySelector("form#frm-finishattempt") ?? formWithAction2(root, QUIZ_PROCESS_PATH);
  if (!finish || !rows.length) throw deps.fail(`Moodle did not show the summary of attempt ${attemptId}: ${noticesOf2(html) || "the page has no finish button"}`);
  const form = { action: resolveUrl(deps.baseUrl, finish.getAttribute("action") ?? ""), fields: formFields2(finish) };
  return { attempt: attemptId, quiz_id: quizId, name: pageHeading(root), rows, url, form };
}
async function finishQuizAttempt(deps, attemptId, quizId) {
  const summary = await loadAttemptSummary(deps, attemptId, quizId);
  const response = await deps.request(summary.form.action, postInit(summary.form.fields));
  const html = await response.text();
  const receipt = { attempt: attemptId, quiz_id: quizId, name: summary.name, summary: summary.rows, url: response.url };
  if (onPath(response.url, QUIZ_REVIEW_PATH)) {
    receipt.review = parseQuizReviewHtml(html, attemptId, deps.baseUrl);
    return receipt;
  }
  const quiz = parseQuizHtml(onPath(response.url, QUIZ_VIEW_PATH) ? html : await pageText2(deps, `${deps.baseUrl}${QUIZ_VIEW_PATH}?id=${quizId}`), quizId, deps.baseUrl);
  const row = quiz.attempts.find((attempt) => attempt.id === attemptId);
  if (row && /in progress/iu.test(row.status)) throw deps.fail(`Moodle accepted the finish request but still lists attempt ${attemptId} as ${row.status}; check the quiz in a browser.`);
  receipt.url = quiz.url;
  if (row) {
    receipt.result = { status: row.status, marks: row.marks, grade: row.grade, completed: row.completed };
    return receipt;
  }
  const probe = await deps.request(attemptUrl(deps.baseUrl, attemptId, quizId, 0));
  if (onPath(probe.url, QUIZ_ATTEMPT_PATH) && parse4(await probe.text()).querySelector("form#responseform")) throw deps.fail(`Moodle accepted the finish request but attempt ${attemptId} is still open; check the quiz in a browser.`);
  return receipt;
}
function parseAttemptPage(html, url, deps) {
  const root = parse4(html);
  const form = root.querySelector("form#responseform");
  if (!form) throw deps.fail(`Moodle did not render an attempt page: ${noticesOf2(html) || "no response form found"}`);
  const attempt = numberParam(url, "attempt") ?? Number(form.querySelector("input[name=attempt]")?.getAttribute("value"));
  const quizId = numberParam(form.getAttribute("action") ?? "", "cmid") ?? numberParam(url, "cmid") ?? 0;
  const page = Number(form.querySelector("input[name=thispage]")?.getAttribute("value") ?? numberParam(url, "page") ?? 0);
  const buttons = root.querySelectorAll(".qnbutton");
  const navigation = buttons.map((button) => {
    const title = button.getAttribute("title") ?? "";
    const match = title.match(/^(?:Question|Information)?\s*(\S+)\s*-\s*(.+)$/u);
    return {
      slot: Number(button.getAttribute("id")?.replace(/^quiznavbutton/u, "") ?? 0),
      number: match?.[1] ?? cleanText(button.textContent),
      page: Number(button.getAttribute("data-quiz-page") ?? 0),
      state: match?.[2] ?? ""
    };
  });
  const questions = form.querySelectorAll("div.que").map(parseAttemptQuestion);
  return {
    attempt,
    quiz_id: quizId,
    name: pageHeading(root),
    navigation_method: buttons.some((button) => button.classList.contains("sequential")) ? "sequential" : "free",
    page,
    pages: Math.max(page + 1, ...navigation.map((entry) => entry.page + 1)),
    questions,
    navigation,
    url: attemptUrl(deps.baseUrl, attempt, quizId, page),
    form: { action: resolveUrl(deps.baseUrl, form.getAttribute("action") ?? ""), fields: formFields2(form) }
  };
}
function parseAttemptQuestion(que) {
  const slot = Number(que.getAttribute("id")?.split("-").at(-1) ?? 0);
  const base = {
    slot,
    number: cleanText(que.querySelector(".info .qno, .info .no")?.textContent).replace(/^Question\s*/iu, "") || "i",
    type: que.classList.value[1] ?? "",
    kind: "unsupported",
    state: cleanText(que.querySelector(".info .state")?.textContent),
    text: blockText(que.querySelector(".qtext"))
  };
  if (que.classList.contains("description")) return { ...base, number: "i", kind: "info" };
  const inputs = que.querySelectorAll("input, textarea, select").filter((input) => {
    const name = input.getAttribute("name") ?? "";
    return name.startsWith("q") && !/_:(?:flagged|sequencecheck)$|_-seen$|_answerformat$/u.test(name) && !/^(?:hidden|submit)$/u.test(input.getAttribute("type") ?? "");
  });
  const tag = (input) => input.tagName.toLowerCase();
  const type = (input) => tag(input) === "input" ? (input.getAttribute("type") ?? "text").toLowerCase() : tag(input);
  const isClearChoice = (input) => type(input) === "radio" && (input.closest(".qtype_multichoice_clearchoice") !== null || input.getAttribute("aria-hidden") === "true");
  const radios = inputs.filter((input) => type(input) === "radio" && !isClearChoice(input));
  const boxes = inputs.filter((input) => type(input) === "checkbox");
  const texts = inputs.filter((input) => ["textarea", "text", "number"].includes(type(input)));
  const selects = inputs.filter((input) => type(input) === "select");
  const others = inputs.length - radios.length - boxes.length - texts.length - selects.length - inputs.filter(isClearChoice).length;
  const radioNames = new Set(radios.map((input) => input.getAttribute("name")));
  const only = (group) => group.length === inputs.length - inputs.filter(isClearChoice).length && others === 0;
  if (radios.length && radioNames.size === 1 && only(radios)) {
    return { ...base, kind: "choice", field: radios[0].getAttribute("name"), options: radios.map((input, index) => option(que, input, index)) };
  }
  if (boxes.length && only(boxes)) return { ...base, kind: "multi", options: boxes.map((input, index) => option(que, input, index)) };
  if (selects.length === 1 && only(selects)) {
    const select = selects[0];
    const name = select.getAttribute("name");
    const choices = select.querySelectorAll("option").filter((item) => (item.getAttribute("value") ?? "") !== "");
    return { ...base, kind: "choice", field: name, options: choices.map((item, index) => ({ key: String.fromCharCode(97 + index), field: name, value: item.getAttribute("value") ?? "", text: cleanText(item.textContent), chosen: item.hasAttribute("selected") })) };
  }
  if (texts.length === 1 && only(texts)) {
    const text = texts[0];
    const html = tag(text) === "textarea";
    return { ...base, kind: "text", field: text.getAttribute("name"), answer: html ? blockText(parse4(text.textContent)) : cleanText(text.getAttribute("value") ?? "") };
  }
  return base;
}
function option(que, input, index) {
  const labelId = input.getAttribute("aria-labelledby");
  const id = input.getAttribute("id");
  const label = (labelId ? que.querySelector(`[id="${labelId}"]`) : null) ?? (id ? que.querySelector(`label[for="${id}"]`) : null) ?? input.parentNode;
  const text = blockText(label) || label?.querySelectorAll("img").map((img) => cleanText(img.getAttribute("alt"))).filter(Boolean).join(" ") || "(image; see the quiz in a browser)";
  return { key: String.fromCharCode(97 + index), field: input.getAttribute("name") ?? "", value: input.getAttribute("value") ?? "", text, chosen: input.hasAttribute("checked") };
}
function encodeAnswer(deps, form, question, value) {
  const raw = value.trim();
  if (question.kind === "info") throw deps.usage(`Question ${question.number} is an information block; it takes no answer.`);
  if (question.kind === "unsupported" || !question.field && question.kind !== "multi") throw deps.usage(`Question ${question.number} is a ${question.type || "question"} type the CLI cannot answer.`, "Answer it in a browser; other questions can still be answered here.");
  if (question.kind === "text") {
    if (!raw) throw deps.usage(`Question ${question.number} needs a written answer.`);
    const format = form.fields.find(([name]) => name === `${question.field}format`)?.[1];
    return [...form.fields.filter(([name]) => name !== question.field), [question.field, format === "1" ? paragraphs(value) : raw]];
  }
  const options = question.options ?? [];
  const picks = raw.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = options.find((item) => item.key === part.toLowerCase()) ?? options.find((item) => cleanText(item.text).toLowerCase() === part.toLowerCase());
    if (!match) throw deps.usage(`Question ${question.number} has no option '${part}'.`, `Choose from ${options.map((item) => item.key).join(", ")}.`);
    return match;
  });
  if (!picks.length) throw deps.usage(`Question ${question.number} needs an option letter.`, `Choose from ${options.map((item) => item.key).join(", ")}.`);
  if (question.kind === "choice") {
    if (picks.length > 1) throw deps.usage(`Question ${question.number} takes one option, not ${picks.length}.`);
    return [...form.fields.filter(([name]) => name !== question.field), [question.field, picks[0].value]];
  }
  const chosen = new Set(picks.map((pick) => pick.key));
  const boxNames = new Set(options.map((item) => item.field));
  return [
    ...form.fields.filter(([name]) => !boxNames.has(name)),
    ...options.map((item) => [item.field, chosen.has(item.key) ? "1" : "0"])
  ];
}
function infoLine(root, label) {
  for (const p of root.querySelectorAll(".quizinfo p, .quizattempt p")) {
    const line = cleanText(p.textContent);
    if (line.startsWith(label)) return line.slice(label.length).trim();
  }
  return "";
}
function noticesOf2(html) {
  const root = parse4(html);
  const texts = [];
  for (const node of root.querySelectorAll(".alert, .errorbox, .error, #notice")) {
    for (const junk of node.querySelectorAll("button, .close")) junk.remove();
    const text = cleanText(node.textContent);
    if (text && !texts.includes(text)) texts.push(text);
  }
  return texts.join(" ");
}
function formWithAction2(root, path) {
  return root.querySelectorAll("form").find((form) => onPath(form.getAttribute("action") ?? "", path)) ?? null;
}
function formFields2(form) {
  const fields = [];
  for (const element of form.querySelectorAll("input, textarea, select")) {
    const name = element.getAttribute("name");
    if (!name) continue;
    const tag = element.tagName.toLowerCase();
    if (tag === "textarea") {
      fields.push([name, element.textContent]);
      continue;
    }
    if (tag === "select") {
      const options = element.querySelectorAll("option");
      const chosen = options.find((item) => item.hasAttribute("selected")) ?? options[0];
      if (chosen) fields.push([name, chosen.getAttribute("value") ?? cleanText(chosen.textContent)]);
      continue;
    }
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (["submit", "button", "image", "file", "reset"].includes(type)) continue;
    if ((type === "checkbox" || type === "radio") && !element.hasAttribute("checked")) continue;
    fields.push([name, element.getAttribute("value") ?? (type === "checkbox" ? "on" : "")]);
  }
  return fields;
}
function postInit(fields) {
  return { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() };
}
async function pageText2(deps, url) {
  return (await deps.request(url)).text();
}
function attemptUrl(baseUrl, attempt, quizId, page) {
  return `${baseUrl}${QUIZ_ATTEMPT_PATH}?attempt=${attempt}&cmid=${quizId}${page ? `&page=${page}` : ""}`;
}
function pageHeading(root) {
  const heading = cleanText(root.querySelector(".page-header-headings h1, #page-header h1")?.textContent);
  if (heading) return heading;
  const title = cleanText(root.querySelector("title")?.textContent).replace(/\s*\(page \d+ of \d+\)/iu, "").split(" | ")[0].trim();
  return title || cleanText(root.querySelector("h2")?.textContent);
}
function onPath(url, path) {
  try {
    return new URL(url, "https://moodle.invalid").pathname.endsWith(path);
  } catch {
    return false;
  }
}
function numberParam(url, key) {
  try {
    const value = Number(new URL(url, "https://moodle.invalid").searchParams.get(key));
    return Number.isSafeInteger(value) && value > 0 ? value : key === "page" && value === 0 ? 0 : null;
  } catch {
    return null;
  }
}
function paragraphs(text) {
  const escaped = text.trim().replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  return escaped.split(/\n\s*\n/u).map((block) => `<p>${block.trim().replace(/\n/gu, "<br>")}</p>`).join("");
}

// src/moodle-forum-core.ts
var ForumModule = class {
  baseUrl;
  callMoodle;
  loadPage;
  loadCourses;
  loadCourseContents;
  forumDiscussionCache = /* @__PURE__ */ new Map();
  groupResolved = /* @__PURE__ */ new Set();
  forumDiscussionRefsCache = /* @__PURE__ */ new Map();
  // The forum view page answers both "what type is this forum" and "which
  // discussions does it list"; load it once per forum.
  forumViewCache = /* @__PURE__ */ new Map();
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.callMoodle = options.call;
    this.loadPage = options.getPage;
    this.loadCourses = options.getCourses;
    this.loadCourseContents = options.getCourseContents;
  }
  // The posts service does not name the discussion's group; that costs a page load,
  // so callers that never show groups (announcements, thread pages) opt out.
  async getForumDiscussion(discussionId, options = {}) {
    const wantGroup = options.group !== false;
    const cached = this.forumDiscussionCache.get(discussionId);
    if (cached) {
      if (wantGroup && cached.group_id <= 0 && !this.groupResolved.has(discussionId)) await this.resolveGroup(cached);
      return cached;
    }
    try {
      const data = await this.callMoodle(FUNC_GET_DISCUSSION_POSTS, {
        discussionid: discussionId,
        sortby: "created",
        sortdirection: "ASC",
        includeinlineattachments: true
      });
      const discussion2 = parseForumDiscussion(data, discussionId, this.baseUrl);
      if (wantGroup && discussion2.group_id <= 0) await this.resolveGroup(discussion2);
      this.forumDiscussionCache.set(discussionId, discussion2);
      return discussion2;
    } catch (error) {
      if (!shouldFallbackForumAjax(error)) {
        throw error;
      }
    }
    const html = await this.loadPage(FORUM_DISCUSS_PATH, { d: discussionId });
    const discussion = parseForumDiscussionHtml(html, this.baseUrl, discussionId);
    this.groupResolved.add(discussionId);
    this.forumDiscussionCache.set(discussionId, discussion);
    return discussion;
  }
  async resolveGroup(discussion) {
    this.groupResolved.add(discussion.id);
    const html = await this.loadPage(FORUM_DISCUSS_PATH, { d: discussion.id }).catch(() => "");
    if (!html) return;
    const [groupId, groupName] = parseForumDiscussionGroupHtml(html);
    discussion.group_id = groupId;
    discussion.group_name = groupName;
  }
  async getForumViewCmid(discussionId) {
    const html = await this.loadPage(FORUM_DISCUSS_PATH, { d: discussionId });
    return parseForumViewCmidFromDiscussionHtml(html);
  }
  async getForumDiscussionRefs(forumCmid) {
    const cached = this.forumDiscussionRefsCache.get(forumCmid);
    if (cached) {
      return cached;
    }
    const html = await this.forumViewHtml(forumCmid);
    const groups = parseForumGroupsHtml(html);
    const refs = groups.length ? [] : parseForumDiscussionRefsHtml(html, this.baseUrl);
    const seenIds = new Set(refs.map((ref) => ref.id));
    for (const [groupId, groupName] of groups) {
      const groupHtml = await this.loadPage(FORUM_VIEW_PATH, { id: forumCmid, group: groupId });
      for (const ref of parseForumDiscussionRefsHtml(groupHtml, this.baseUrl)) {
        if (seenIds.has(ref.id)) {
          continue;
        }
        seenIds.add(ref.id);
        refs.push({ ...ref, group_id: groupId, group_name: groupName });
      }
    }
    this.forumDiscussionRefsCache.set(forumCmid, refs);
    return refs;
  }
  forumViewHtml(forumCmid) {
    const pending = this.forumViewCache.get(forumCmid) ?? this.loadPage(FORUM_VIEW_PATH, { id: forumCmid });
    this.forumViewCache.set(forumCmid, pending);
    pending.catch(() => this.forumViewCache.delete(forumCmid));
    return pending;
  }
  async isNewsForum(forumCmid) {
    return /\bforumtype-news\b|data-forumtype=["']news["']/u.test(await this.forumViewHtml(forumCmid));
  }
  async getCourseForums(courseId, courseName = "") {
    if (!this.loadCourseContents) {
      throw new Error("getCourseContents loader is required to list course forums");
    }
    const sections = await this.loadCourseContents(courseId);
    return sections.flatMap(
      (section) => section.activities.filter((activity) => activity.modname === "forum").map((activity) => ({
        id: activity.id,
        name: activity.name,
        course_id: courseId,
        course_name: courseName,
        url: activity.url
      }))
    );
  }
  async getForums(courseId) {
    if (courseId !== void 0) {
      const courseName = await this.courseName(courseId);
      return this.getCourseForums(courseId, courseName);
    }
    if (!this.loadCourses) {
      throw new Error("getCourses loader is required to list all forums");
    }
    const courses = await this.loadCourses();
    const forums = [];
    for (let index = 0; index < courses.length; index += 4) {
      const batch = await Promise.all(courses.slice(index, index + 4).map((course) => this.getCourseForums(course.id, course.fullname || course.shortname)));
      forums.push(...batch.flat());
    }
    return forums;
  }
  async courseName(courseId) {
    if (!this.loadCourses) {
      return "";
    }
    const course = (await this.loadCourses()).find((item) => item.id === courseId);
    return course ? course.fullname || course.shortname : "";
  }
};
function shouldFallbackForumAjax(error) {
  if (!isRecord2(error)) {
    return false;
  }
  const code = typeof error.moodleErrorCode === "string" ? error.moodleErrorCode : "";
  return code === "servicenotavailable" || code === "accessexception" || error instanceof Error && error.message.includes("Web service is not available");
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/moodle-forum-search-core.ts
async function searchForumContent(source, query, options = {}) {
  const cleanedQuery = query.trim();
  if (!cleanedQuery) {
    return [];
  }
  const includePostText = options.includePostText ?? true;
  const titlesOnly = options.titlesOnly ?? false;
  const unreadOnly = options.unreadOnly ?? false;
  const sortBy = options.sortBy ?? "relevance";
  let forumRefs = await source.getForums(options.courseId);
  if (options.forumCmid !== void 0) {
    forumRefs = forumRefs.filter((ref) => ref.id === options.forumCmid);
    if (!forumRefs.length) {
      forumRefs = [
        {
          id: options.forumCmid,
          name: "",
          course_id: 0,
          course_name: "",
          url: `${(options.baseUrl ?? "").replace(/\/$/, "")}/mod/forum/view.php?id=${options.forumCmid}`
        }
      ];
    }
  } else if (options.maxForums !== void 0) {
    forumRefs = forumRefs.slice(0, options.maxForums);
  }
  const hits = [];
  const seen = /* @__PURE__ */ new Set();
  const needsPosts = !titlesOnly || unreadOnly || sortBy === "recent";
  const listings = await inParallel(forumRefs, 3, async (forumRef) => {
    const refs = await source.getForumDiscussionRefs(forumRef.id);
    return options.maxDiscussionsPerForum !== void 0 ? refs.slice(0, options.maxDiscussionsPerForum) : refs;
  });
  const discussions = /* @__PURE__ */ new Map();
  if (needsPosts) {
    const refs = listings.flat();
    const loaded = await inParallel(refs, 4, (ref) => source.getForumDiscussion(ref.id));
    for (const [index, ref] of refs.entries()) discussions.set(ref.id, loaded[index]);
  }
  for (const [forumIndex, forumRef] of forumRefs.entries()) {
    const refs = listings[forumIndex];
    for (const ref of refs) {
      let discussion = null;
      let latestPost = null;
      let discussionHasUnread = false;
      const matchingPostHits = [];
      if (needsPosts) {
        discussion = discussions.get(ref.id) ?? await source.getForumDiscussion(ref.id);
        if (discussion.posts.length) {
          latestPost = discussion.posts.reduce((latest, post) => (post.time_created || 0) > (latest.time_created || 0) ? post : latest);
          discussionHasUnread = discussion.posts.some((post) => post.unread);
        }
      }
      if (titlesOnly) {
        addSubjectHit({
          hits,
          seen,
          score: matchScore(ref.subject, cleanedQuery),
          query: cleanedQuery,
          ref,
          forumRef,
          discussionHasUnread,
          unreadOnly,
          latestPost
        });
        continue;
      }
      discussion ??= await source.getForumDiscussion(ref.id);
      for (const post of discussion.posts) {
        const postSubjectScore = matchScore(post.subject, cleanedQuery);
        const postBodyScore = matchScore(post.message_text, cleanedQuery);
        if (postSubjectScore <= 0 && postBodyScore <= 0) {
          continue;
        }
        if (unreadOnly && !post.unread) {
          continue;
        }
        const matchedIn = postSubjectScore >= postBodyScore ? "post_subject" : "post_body";
        const matchedText = matchedIn === "post_subject" ? post.subject : post.message_text;
        matchingPostHits.push([
          300 + Math.max(postSubjectScore, postBodyScore),
          {
            course_id: forumRef.course_id,
            course_name: forumRef.course_name,
            forum_id: forumRef.id,
            forum_name: forumRef.name,
            group_id: discussion.group_id || ref.group_id,
            group_name: discussion.group_name || ref.group_name,
            discussion_id: ref.id,
            discussion_subject: discussion.subject || ref.subject,
            post_id: post.id,
            author_name: post.author.fullname,
            matched_in: matchedIn,
            snippet: snippetForText(matchedText, cleanedQuery),
            unread: post.unread,
            time_created: post.time_created,
            url: post.url || ref.url
          }
        ]);
      }
      if (matchingPostHits.length) {
        for (const [score, hit] of matchingPostHits) {
          const key = hitKey(hit.discussion_id, hit.post_id);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          hits.push([score, hit]);
        }
        continue;
      }
      addSubjectHit({
        hits,
        seen,
        score: matchScore(ref.subject, cleanedQuery),
        query: cleanedQuery,
        ref,
        forumRef,
        discussionHasUnread,
        unreadOnly,
        latestPost
      });
    }
  }
  hits.sort(sortBy === "recent" ? sortRecent : sortRelevant);
  return hits.slice(0, options.limit ?? 20).map(([, hit]) => includePostText ? hit : { ...hit, snippet: "" });
}
async function inParallel(items, size2, run) {
  const results = [];
  for (let index = 0; index < items.length; index += size2) results.push(...await Promise.all(items.slice(index, index + size2).map(run)));
  return results;
}
function normalizeQuery(value) {
  const normalized = value.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  return { normalized, tokens: normalized ? normalized.split(/\s+/) : [] };
}
function matchScore(text, query) {
  const haystack = text.toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  if (!haystack) {
    return 0;
  }
  const { normalized, tokens } = normalizeQuery(query);
  if (!normalized) {
    return 0;
  }
  if (haystack.includes(normalized)) {
    return 100 + normalized.length;
  }
  if (tokens.length && tokens.every((token) => haystack.includes(token))) {
    return 60 + tokens.length;
  }
  return 0;
}
function snippetForText(text, query, maxLen = 120) {
  const cleaned = text.split(/\s+/).filter(Boolean).join(" ");
  if (!cleaned) {
    return "";
  }
  const { normalized, tokens } = normalizeQuery(query);
  const lower = cleaned.toLowerCase();
  let start = normalized ? lower.indexOf(normalized) : -1;
  if (start < 0) {
    for (const token of tokens) {
      start = lower.indexOf(token);
      if (start >= 0) {
        break;
      }
    }
  }
  if (start < 0 || cleaned.length <= maxLen) {
    return cleaned.length <= maxLen ? cleaned : `${cleaned.slice(0, maxLen - 1)}\u2026`;
  }
  const half = Math.floor(maxLen / 2);
  const left = Math.max(0, start - half);
  const right = Math.min(cleaned.length, left + maxLen);
  let snippet = cleaned.slice(left, right);
  if (left > 0) {
    snippet = `\u2026${snippet}`;
  }
  if (right < cleaned.length) {
    snippet = `${snippet}\u2026`;
  }
  return snippet;
}
function addSubjectHit(args) {
  if (args.score <= 0 || args.unreadOnly && !args.discussionHasUnread) {
    return;
  }
  const key = hitKey(args.ref.id, 0);
  if (args.seen.has(key)) {
    return;
  }
  args.seen.add(key);
  args.hits.push([
    400 + args.score,
    {
      course_id: args.forumRef.course_id,
      course_name: args.forumRef.course_name,
      forum_id: args.forumRef.id,
      forum_name: args.forumRef.name,
      group_id: args.ref.group_id,
      group_name: args.ref.group_name,
      discussion_id: args.ref.id,
      discussion_subject: args.ref.subject,
      post_id: 0,
      author_name: "",
      matched_in: "discussion_subject",
      snippet: snippetForText(args.ref.subject, args.query),
      unread: args.discussionHasUnread,
      time_created: args.latestPost?.time_created ?? 0,
      url: args.ref.url
    }
  ]);
}
function sortRecent(a, b) {
  return (b[1].time_created || 0) - (a[1].time_created || 0) || b[0] - a[0] || compareText(a[1].course_name, b[1].course_name) || compareText(a[1].forum_name, b[1].forum_name) || a[1].discussion_id - b[1].discussion_id || a[1].post_id - b[1].post_id;
}
function sortRelevant(a, b) {
  return b[0] - a[0] || compareText(a[1].course_name, b[1].course_name) || compareText(a[1].forum_name, b[1].forum_name) || a[1].discussion_id - b[1].discussion_id || a[1].post_id - b[1].post_id;
}
function compareText(a, b) {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}
function hitKey(discussionId, postId) {
  return `${discussionId}:${postId}`;
}

// src/moodle-client-core.ts
var STANDARD_MODULES = /* @__PURE__ */ new Set([
  "assign",
  "bigbluebuttonbn",
  "book",
  "chat",
  "choice",
  "data",
  "feedback",
  "folder",
  "forum",
  "glossary",
  "h5pactivity",
  "imscp",
  "label",
  "lesson",
  "lti",
  "page",
  "qbank",
  "quiz",
  "resource",
  "scorm",
  "subsection",
  "survey",
  "url",
  "wiki",
  "workshop"
]);
var ACTIVITY_SEARCH_BATCH_SIZE = 20;
var MoodleClientCoreError = class extends Error {
  code;
  hint;
  constructor(code, message, hint) {
    super(message);
    this.name = "MoodleClientCoreError";
    this.code = code;
    this.hint = hint;
  }
};
var MoodleClientCoreApiError = class extends MoodleClientCoreError {
  moodleErrorCode;
  constructor(message, moodleErrorCode) {
    const auth = isLoginErrorCode(moodleErrorCode);
    const notFound = ["invalidrecord", "invalidcoursemodule"].includes(moodleErrorCode ?? "") || /\bHTTP 404\b/.test(message);
    super(
      auth ? "auth" : notFound ? "not_found" : "upstream",
      message,
      auth ? "Refresh the Moodle session." : void 0
    );
    this.name = "MoodleClientCoreApiError";
    this.moodleErrorCode = moodleErrorCode;
  }
};
var DEFAULT_ERROR_ADAPTER = {
  api: (message, moodleErrorCode) => new MoodleClientCoreApiError(message, moodleErrorCode),
  notFound: (message) => new MoodleClientCoreError("not_found", message),
  isApi: (error) => error instanceof MoodleClientCoreApiError,
  isLoginRequired: (error) => error instanceof MoodleClientCoreApiError && isLoginErrorCode(error.moodleErrorCode)
};
var AjaxEnvelopeSchema = z.array(
  z.object({
    index: z.number().int().nonnegative().optional(),
    error: z.boolean().optional(),
    data: z.unknown().optional(),
    exception: z.object({
      message: z.string().optional(),
      errorcode: z.string().optional()
    }).passthrough().optional()
  }).passthrough()
);
var MoodleClientCore = class {
  baseUrl;
  coursesCache;
  contentsCache = /* @__PURE__ */ new Map();
  unavailable;
  unavailableListeners = /* @__PURE__ */ new Set();
  fetchImpl;
  cookie;
  sesskey;
  userid;
  userInfo;
  clearSessionCache;
  writeSessionCache;
  errors;
  onLoginRequired;
  // Reads run in parallel and Moodle rejects them all at once; they must share one
  // reauthentication. The generation tells a late rejection that a newer session exists.
  authGeneration = 0;
  reauthInFlight;
  forum;
  labels;
  constructor(baseUrl, options) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    const resolvedOptions = typeof options === "string" ? { cookie: { name: "MoodleSession", value: options } } : options;
    this.fetchImpl = resolvedOptions.fetchImpl ?? ((input, init) => fetch(input, init));
    this.cookie = resolvedOptions.cookie;
    this.sesskey = resolvedOptions.pageContext?.sesskey ?? resolvedOptions.sesskey ?? null;
    this.userid = resolvedOptions.pageContext?.user_info.userid ?? resolvedOptions.userid ?? null;
    this.userInfo = resolvedOptions.pageContext?.user_info ?? resolvedOptions.userInfo ?? (this.userid ? placeholderUserInfo(this.baseUrl, this.userid) : null);
    this.unavailable = new Set(resolvedOptions.unavailable ?? []);
    this.clearSessionCache = resolvedOptions.clearSessionCache;
    this.writeSessionCache = resolvedOptions.writeSessionCache;
    this.errors = resolvedOptions.errorAdapter ?? DEFAULT_ERROR_ADAPTER;
    this.onLoginRequired = resolvedOptions.onLoginRequired;
    this.forum = new ForumModule({
      baseUrl: this.baseUrl,
      call: async (functionName, args) => {
        await this.ensureSession();
        return this.call(functionName, args);
      },
      getPage: (path, params) => this.get(path, params),
      getCourses: () => this.getCourses(),
      getCourseContents: (courseId) => this.getCourseContents(courseId)
    });
  }
  async getSiteInfo() {
    await this.ensureSession();
    try {
      if (this.noteIfUnavailable(FUNC_GET_SITE_INFO) && this.userInfo?.fullname) return this.userInfo;
      const data = await this.call(FUNC_GET_SITE_INFO);
      if (isRecord3(data) && "userid" in data) {
        const info = parseUserInfo(data);
        this.sesskey = typeof data.sesskey === "string" ? data.sesskey : this.sesskey;
        this.userid = info.userid;
        this.userInfo = info;
        await this.writeCache();
        return info;
      }
    } catch (error) {
      if (!this.errors.isApi(error) || error.moodleErrorCode !== "servicenotavailable") {
        throw error;
      }
    }
    if (this.userInfo?.fullname) {
      return this.userInfo;
    }
    const html = await this.get(DASHBOARD_PATH);
    const context = parsePageContext(html, this.baseUrl);
    if (!context.user_info.fullname && this.userInfo) {
      return this.userInfo;
    }
    this.applyContext(context);
    await this.writeCache();
    return context.user_info;
  }
  // Resolution, forum listing and every screen ask for the unit list, and sites that
  // disable the enrolment service pay three requests for each answer. A short memo
  // keeps one command to one round trip without pinning a server to stale enrolments.
  async getCourses() {
    if (!this.coursesCache || Date.now() - this.coursesCache.at > 6e4) {
      this.coursesCache = { at: Date.now(), courses: this.fetchCourses() };
    }
    try {
      return await this.coursesCache.courses;
    } catch (error) {
      this.coursesCache = void 0;
      throw error;
    }
  }
  async fetchCourses() {
    await this.ensureSession();
    try {
      const data = await this.call(FUNC_GET_COURSES, { userid: this.userid });
      return parseCourses(data);
    } catch (error) {
      if (!this.errors.isApi(error) || error.moodleErrorCode !== "servicenotavailable") {
        throw error;
      }
      return this.getCoursesTimeline();
    }
  }
  async resolveCourseReference(value) {
    return resolveUnit(value, await this.getCourses()).id;
  }
  // One command asks for the same unit's sections from several places (resolution,
  // forum listing, screens); fetch once per client and let a failure retry next time.
  async getCourseContents(courseId) {
    const pending = this.contentsCache.get(courseId) ?? this.fetchCourseContents(courseId);
    this.contentsCache.set(courseId, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.contentsCache.get(courseId) === pending) this.contentsCache.delete(courseId);
      throw error;
    }
  }
  async fetchCourseContents(courseId) {
    await this.ensureSession();
    try {
      return parseCourseContents(await this.call(FUNC_GET_COURSE_CONTENTS, { courseid: courseId }));
    } catch (error) {
      if (!this.errors.isApi(error) || error.moodleErrorCode !== "servicenotavailable") {
        throw error;
      }
    }
    try {
      const sections = parseCourseFormatState(
        await this.call(FUNC_GET_COURSE_FORMAT_STATE, { courseid: courseId }),
        this.baseUrl
      );
      if (sections.length) return sections;
    } catch (error) {
      if (!this.errors.isApi(error) || error.moodleErrorCode !== "servicenotavailable") {
        throw error;
      }
    }
    const response = await this.get(COURSE_PATH, { id: courseId });
    return this.scrapeCourseContents(courseId, response);
  }
  async getActivities(courseId) {
    return (await this.getCourseContents(courseId)).flatMap((section) => section.activities);
  }
  async getActivity(id) {
    return this.readActivity(id, true);
  }
  async readActivity(id, followAlias) {
    await this.ensureSession();
    let activity = null;
    let courseId;
    let type = "";
    try {
      const data = await this.call(FUNC_GET_COURSE_MODULE, { cmid: id });
      const module = isRecord3(data) && isRecord3(data.cm) ? data.cm : data;
      type = isRecord3(module) && typeof module.modname === "string" ? module.modname : "";
      courseId = isRecord3(module) && typeof module.course === "number" ? module.course : void 0;
    } catch (error) {
      if (!this.errors.isApi(error) || error.moodleErrorCode !== "servicenotavailable") {
        throw error;
      }
      activity = await this.findActivity(id);
      type = activity.modname;
    }
    const loaders = {
      assign: () => this.getAssignment(id),
      quiz: () => this.getQuiz(id),
      resource: () => this.getResource(id),
      url: () => this.getLink(id),
      page: () => this.getPage(id),
      folder: () => this.getFolder(id)
    };
    const load = loaders[type];
    if (!load) {
      const alias = followAlias && /^[a-z][a-z0-9_]*$/u.test(type) && !STANDARD_MODULES.has(type) ? await this.redirectedActivity(type, id) : void 0;
      if (alias) return this.readActivity(alias, false);
      activity ??= await this.findActivity(id, courseId);
      return { ...activity, type: type || activity.modname || "unknown" };
    }
    return { ...await load(), type: type === "url" ? "link" : type };
  }
  async redirectedActivity(type, id) {
    const response = await this.requestAbsolute(`${this.baseUrl}/mod/${type}/view.php?id=${id}`, {}, { allowErrorStatus: true });
    await response.body?.cancel().catch(() => void 0);
    const match = /\/mod\/\w+\/view\.php\?(?:.*&)?id=(\d+)/u.exec(response.url);
    const target = match ? Number(match[1]) : void 0;
    return target && target !== id ? target : void 0;
  }
  async getTodo(limit = 20, days, courseId) {
    await this.ensureSession();
    const now = Math.floor(Date.now() / 1e3);
    const window = { timesortfrom: now, timesortto: days ? now + days * 86400 : 0 };
    const timeline = () => this.readActionEvents(FUNC_GET_ACTION_EVENTS, { ...window, limittononsuspendedevents: true }, limit);
    const unit = (id) => this.readActionEvents(FUNC_GET_ACTION_EVENTS_BY_COURSE, { courseid: id, ...window }, limit);
    if (courseId !== void 0) {
      try {
        return await unit(courseId);
      } catch (error) {
        if (!this.errors.isApi(error) || error.moodleErrorCode !== "servicenotavailable") throw error;
      }
      return (await timeline()).filter((item) => item.course_id === courseId);
    }
    try {
      return await timeline();
    } catch (error) {
      if (!this.errors.isApi(error) || error.moodleErrorCode !== "servicenotavailable") throw error;
    }
    const perUnit = [];
    for (const courses of chunks(await this.getCourses(), 4)) {
      perUnit.push(...await Promise.all(courses.map((course) => unit(course.id))));
    }
    const merged = new Map(perUnit.flat().map((item) => [item.id, item]));
    return [...merged.values()].sort((a, b) => a.due_at - b.due_at || a.id - b.id).slice(0, limit);
  }
  // Moodle caps a calendar page at 50 events and pages by the last event's id.
  async readActionEvents(functionName, args, limit) {
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    let aftereventid = 0;
    while (items.length < limit) {
      const batchSize = Math.min(50, limit - items.length);
      const data = await this.call(functionName, { ...args, aftereventid, limitnum: batchSize });
      const events = isRecord3(data) && Array.isArray(data.events) ? data.events : [];
      for (const item of parseTodoItems(events)) if (!seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
      if (events.length < batchSize) break;
      const last = events.at(-1);
      const next = isRecord3(last) && typeof last.id === "number" ? last.id : void 0;
      if (!next || next === aftereventid) throw this.errors.api("Moodle repeated a calendar page; refine the date window.");
      aftereventid = next;
    }
    return items;
  }
  async getAlerts(limit = 20) {
    await this.ensureSession();
    const [notifications, counts, unread] = await this.callBatchValues([
      { methodname: FUNC_GET_POPUP_NOTIFICATIONS, args: { useridto: this.userid, limit, offset: 0 } },
      { methodname: FUNC_GET_CONVERSATION_COUNTS, args: { userid: this.userid } },
      { methodname: FUNC_GET_UNREAD_CONVERSATION_COUNTS, args: { userid: this.userid } }
    ]);
    return parseAlertSummary(notifications, counts, unread);
  }
  async getOverview(todoLimit = 5, todoDays, alertsLimit = 5) {
    await this.ensureSession();
    if (todoLimit > 50) {
      const snapshot = await this.getOverview(50, todoDays, alertsLimit);
      if (snapshot.todo.length === 50) snapshot.todo = await this.getTodo(todoLimit, todoDays);
      return snapshot;
    }
    const now = Math.floor(Date.now() / 1e3);
    const results = await this.callBatch([
      { methodname: FUNC_GET_COURSES, args: { userid: this.userid } },
      {
        methodname: FUNC_GET_ACTION_EVENTS,
        args: {
          limitnum: todoLimit,
          timesortfrom: now,
          timesortto: todoDays ? now + todoDays * 24 * 60 * 60 : 0,
          aftereventid: 0,
          limittononsuspendedevents: true
        }
      },
      { methodname: FUNC_GET_POPUP_NOTIFICATIONS, args: { useridto: this.userid, limit: alertsLimit, offset: 0 } },
      { methodname: FUNC_GET_CONVERSATION_COUNTS, args: { userid: this.userid } },
      { methodname: FUNC_GET_UNREAD_CONVERSATION_COUNTS, args: { userid: this.userid } }
    ]);
    const [coursesData, todoData, notifications, counts, unread] = results;
    const userPromise = this.userInfo?.fullname ? Promise.resolve(this.userInfo) : this.getSiteInfo();
    const coursesPromise = coursesData?.ok ? Promise.resolve(parseCourses(coursesData.data)) : this.getCourses();
    const todoPromise = todoData?.ok ? Promise.resolve(parseTodoPayload(todoData.data)) : todoData && todoData.error.moodleErrorCode !== "servicenotavailable" ? Promise.reject(todoData.error) : this.getTodo(todoLimit, todoDays);
    const alertResults = [notifications, counts, unread];
    const alertFailureIndex = alertResults.findIndex((result) => result !== void 0 && !result.ok);
    const alertFailure = alertFailureIndex >= 0 ? alertResults[alertFailureIndex] : void 0;
    const alertsPromise = alertFailure && !alertFailure.ok ? Promise.reject(alertFailure.error) : alertResults.every((result) => result?.ok) ? Promise.resolve(parseAlertSummary(
      notifications && notifications.ok ? notifications.data : void 0,
      counts && counts.ok ? counts.data : void 0,
      unread && unread.ok ? unread.data : void 0
    )) : this.getAlerts(alertsLimit);
    const settled = await Promise.allSettled([userPromise, coursesPromise, todoPromise, alertsPromise]);
    const labels = [
      "user",
      "courses",
      "todo",
      alertFailureIndex >= 0 ? ["notifications", "conversation counts", "unread conversation counts"][alertFailureIndex] : "alerts"
    ];
    const errors = settled.flatMap((result, index) => result.status === "rejected" ? [`${labels[index]}: ${errorMessage(result.reason)}`] : []);
    const [userResult, coursesResult, todoResult, alertsResult] = settled;
    return {
      user: userResult.status === "fulfilled" ? userResult.value : this.userInfo,
      courses: coursesResult.status === "fulfilled" ? coursesResult.value : [],
      todo: todoResult.status === "fulfilled" ? todoResult.value : [],
      ...alertsResult.status === "fulfilled" ? { alerts: alertsResult.value } : {},
      errors
    };
  }
  async getCourseGrades(courseId) {
    await this.ensureSession();
    const courseHtml = await this.get(COURSE_PATH, { id: courseId });
    const candidates = [
      parseCourseGradesUrl(courseHtml, this.baseUrl),
      `${this.baseUrl}/course/user.php?mode=grade&id=${courseId}&user=${this.userid}`,
      `${this.baseUrl}${GRADE_REPORT_OVERVIEW_PATH}`,
      `${this.baseUrl}${GRADE_REPORT_INDEX_PATH}?id=${courseId}`,
      `${this.baseUrl}${GRADE_REPORT_PATH}?id=${courseId}`
    ].filter(Boolean);
    const seen = /* @__PURE__ */ new Set();
    let overviewRows = {};
    for (let index = 0; index < candidates.length; index += 1) {
      const url = candidates[index];
      if (seen.has(url)) {
        continue;
      }
      seen.add(url);
      let html = "";
      try {
        html = await this.getAbsolute(url);
      } catch (error) {
        if (this.errors.isApi(error) && error.message.startsWith("HTTP 404")) {
          continue;
        }
        throw error;
      }
      if (hasCourseGradesHtml(html)) {
        return parseCourseGradesHtml(html, courseId, this.baseUrl);
      }
      overviewRows = parseGradeOverviewRows(html, this.baseUrl);
      const row = overviewRows[courseId];
      if (row) {
        if (row.url && !seen.has(row.url)) {
          candidates.push(row.url);
          continue;
        }
        return {
          course_id: courseId,
          course_name: row.course_name,
          learner_name: "",
          total_grade: row.grade,
          total_range: "",
          total_percentage: "",
          items: []
        };
      }
    }
    return {
      course_id: courseId,
      course_name: "",
      learner_name: "",
      total_grade: "",
      total_range: "",
      total_percentage: "",
      items: []
    };
  }
  async getAssignment(id) {
    const [html, labels] = await Promise.all([this.getActivityPage(ASSIGN_VIEW_PATH, "assign", id), this.siteLabels()]);
    return parseAssignmentHtml(html, id, this.baseUrl, labels);
  }
  async getQuiz(id) {
    const [html, labels] = await Promise.all([this.getActivityPage(QUIZ_VIEW_PATH, "quiz", id), this.siteLabels()]);
    return parseQuizHtml(html, id, this.baseUrl, labels);
  }
  /**
   * The site's own text for the labels the page readers look for, in the session's
   * language and with any strings the site customised. One call per client; a site that
   * refuses it leaves the readers on the English labels. A request that failed before
   * Moodle answered reads this page in English and asks again for the next one, so one
   * dropped request does not fix a long-lived client on English.
   */
  siteLabels() {
    this.labels ??= (async () => {
      await this.ensureSession();
      return siteLabelsFrom(await this.call(FUNC_GET_STRINGS, { strings: labelRequests() }));
    })().catch((error) => {
      if (this.errors.isLoginRequired(error)) {
        this.labels = void 0;
        throw error;
      }
      if (!this.errors.isApi(error) || !error.moodleErrorCode) this.labels = void 0;
      return {};
    });
    return this.labels;
  }
  async getQuizAttempt(attemptId) {
    await this.ensureSession();
    const [html, labels] = await Promise.all([this.get(QUIZ_REVIEW_PATH, { attempt: attemptId, showall: 1 }), this.siteLabels()]);
    return parseQuizReviewHtml(html, attemptId, this.baseUrl, labels);
  }
  async getResource(id) {
    const url = `${this.baseUrl}${RESOURCE_VIEW_PATH}?id=${id}`;
    const response = await this.requestAbsolute(url);
    const type = response.headers.get("content-type") ?? "";
    if (type && !/html/iu.test(type)) {
      const finalUrl = response.url || url;
      const disposition = response.headers.get("content-disposition") ?? "";
      const encodedName = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/iu)?.[1];
      const plainName = disposition.match(/filename\s*=\s*"([^"\r\n]+)"/iu)?.[1] || disposition.match(/filename\s*=\s*([^;\r\n]+)/iu)?.[1];
      let filename = plainName || new URL(finalUrl).pathname.split("/").at(-1) || `resource-${id}`;
      try {
        filename = decodeURIComponent(encodedName || filename);
      } catch {
      }
      filename = filename.split(/[\\/]/u).at(-1) || `resource-${id}`;
      await response.body?.cancel();
      return { id, name: filename, course_id: 0, course_name: "", section_name: "", target_name: filename, target_url: url, file_entries: [{ name: filename, url, requires_authentication: true }], url };
    }
    const html = await response.text();
    this.assertActivityPage(html, "resource", id);
    const resource = parseResourceHtml(html, id, this.baseUrl);
    if (!resource.name) {
      const activity = await this.findActivity(id);
      resource.name = activity.name;
      if (!resource.file_entries.length && activity.file_entries?.length) resource.file_entries = activity.file_entries;
    }
    return resource;
  }
  async getLink(id) {
    return parseLinkHtml(await this.getActivityPage(URL_VIEW_PATH, "url", id, { forceview: 1 }), id, this.baseUrl);
  }
  async getPage(id) {
    return parsePageHtml(await this.getActivityPage(PAGE_VIEW_PATH, "page", id), id, this.baseUrl);
  }
  async getFolder(id) {
    return parseFolderHtml(await this.getActivityPage(FOLDER_VIEW_PATH, "folder", id), id, this.baseUrl);
  }
  async getActivityPage(pathname, type, id, params = {}) {
    const html = await this.get(pathname, { id, ...params });
    this.assertActivityPage(html, type, id);
    return html;
  }
  // requireloginerror is what Moodle's own services raise for the same refusal.
  assertActivityPage(html, type, id) {
    if (!isOtherMoodlePage(html, type, id)) return;
    const reason = parseUnavailableNotice(html);
    throw this.errors.api(`Activity ${id} is not available to you${reason ? `. ${reason}` : "."}`, "requireloginerror");
  }
  async requestAbsolute(url, init = {}, options = {}) {
    return this.requestAbsoluteInternal(url, init, true, Boolean(options.allowErrorStatus));
  }
  /** Uploads files into an assignment and reads the receipt back from the site. */
  async submitAssignment(request) {
    await this.ensureSession();
    return submitAssignmentFiles({
      baseUrl: this.baseUrl,
      request: (url, init, options) => this.requestAbsolute(url, init, options),
      fail: (message, moodleErrorCode) => this.errors.api(message, moodleErrorCode),
      usage: (message, hint) => this.errors.usage ? this.errors.usage(message, hint) : new MoodleClientCoreError("usage", message, hint)
    }, request);
  }
  /** Starts a new attempt, or resumes the one already in progress, and returns its first page. */
  async planQuizStart(quizId) {
    return planQuizStart(await this.quizDeps(), quizId);
  }
  async startQuizAttempt(quizId, options = {}) {
    return startQuizAttempt(await this.quizDeps(), quizId, options);
  }
  async getQuizAttemptPage(attemptId, quizId, page, options = {}) {
    return getAttemptPage(await this.quizDeps(), attemptId, quizId, page, options);
  }
  async getQuizAttemptSummary(attemptId, quizId) {
    return getAttemptSummary(await this.quizDeps(), attemptId, quizId);
  }
  async answerQuizQuestion(request) {
    return answerQuizQuestion(await this.quizDeps(), request);
  }
  /** Submits the attempt for grading. Moodle treats this as final. */
  async finishQuizAttempt(attemptId, quizId) {
    return finishQuizAttempt(await this.quizDeps(), attemptId, quizId);
  }
  async quizDeps() {
    await this.ensureSession();
    return {
      baseUrl: this.baseUrl,
      request: (url, init, options) => this.requestAbsolute(url, init, options),
      fail: (message, moodleErrorCode) => this.errors.api(message, moodleErrorCode),
      usage: (message, hint) => this.errors.usage ? this.errors.usage(message, hint) : new MoodleClientCoreError("usage", message, hint)
    };
  }
  async getNewsForums(courseId) {
    const units = courseId === void 0 ? await this.getCourses() : (await this.getCourses()).filter((c) => c.id === courseId);
    const forums = [];
    if (!units.length) return forums;
    try {
      await this.ensureSession();
      const data = await this.call("mod_forum_get_forums_by_courses", { courseids: units.map((c) => c.id) });
      for (const f of Array.isArray(data) ? data : []) {
        if (!isRecord3(f) || f.type !== "news" || typeof f.cmid !== "number") continue;
        const c = units.find((c2) => c2.id === f.course);
        forums.push({ id: f.cmid, name: String(f.name || ""), course_id: Number(f.course), course_name: c?.fullname || "", url: `${this.baseUrl}/mod/forum/view.php?id=${f.cmid}` });
      }
      return forums;
    } catch (error) {
      if (!this.errors.isApi(error) || error.moodleErrorCode !== "servicenotavailable") throw error;
    }
    const candidates = await this.getForums(courseId);
    const flags = [];
    for (let index = 0; index < candidates.length; index += 4) {
      flags.push(...await Promise.all(candidates.slice(index, index + 4).map((forum) => this.forum.isNewsForum(forum.id))));
    }
    return candidates.filter((_, index) => flags[index]);
  }
  async getForumDiscussion(discussionId, options = {}) {
    return this.forum.getForumDiscussion(discussionId, options);
  }
  async getForumViewCmid(discussionId) {
    return this.forum.getForumViewCmid(discussionId);
  }
  async resolveCourseIdForUrl(url) {
    return parseCourseIdFromPageHtml(await this.getAbsolute(url));
  }
  async getForumDiscussionRefs(forumCmid) {
    return this.forum.getForumDiscussionRefs(forumCmid);
  }
  async getForums(courseId) {
    return this.forum.getForums(courseId);
  }
  async searchForumContent(options) {
    const { query, ...searchOptions } = options;
    return searchForumContent(this.forum, query, { ...searchOptions, baseUrl: this.baseUrl });
  }
  /**
   * Hears every call the site refuses as disabled, whether it says so now or said so
   * earlier, so a caller can tell which fallback a command took.
   */
  onServiceUnavailable(listener) {
    this.unavailableListeners.add(listener);
    return () => this.unavailableListeners.delete(listener);
  }
  /** Forgets which services earlier sessions found disabled, so the next calls ask the site again. */
  async forgetUnavailableServices() {
    this.unavailable.clear();
    await this.writeCache();
  }
  async callBatch(requests) {
    await this.ensureSession();
    return this.callBatchInternal(requests, true);
  }
  async call(functionName, args = {}) {
    const [result] = await this.callBatchValues([{ methodname: functionName, args }]);
    return result;
  }
  async callBatchValues(requests) {
    const results = await this.callBatchInternal(requests, true);
    const missing = results.findIndex((result) => result === void 0);
    if (missing >= 0) {
      throw this.errors.api(`Moodle returned an incomplete AJAX batch response at index ${missing}.`, "incompletebatch");
    }
    const completeResults = results;
    const failed = completeResults.find((result) => !result.ok);
    if (failed && !failed.ok) {
      throw failed.error;
    }
    return completeResults.map((result) => result.ok ? result.data : void 0);
  }
  // Moodle stops a batch at its first failing function, so a service the site has
  // disabled would void every call queued behind it. Known-disabled functions are
  // answered locally and only the rest travel.
  async callBatchInternal(requests, allowRetry) {
    const live = requests.map((request, index) => ({ request, index })).filter(({ request }) => !this.unavailable.has(request.methodname));
    if (live.length < requests.length) {
      const results2 = Array(requests.length).fill(void 0);
      for (const [index, request] of requests.entries()) {
        if (live.some((entry) => entry.index === index)) continue;
        this.noteIfUnavailable(request.methodname);
        results2[index] = { ok: false, error: this.errors.api(`${request.methodname} is disabled on this site.`, "servicenotavailable") };
      }
      if (live.length) {
        const sent = await this.callBatchInternal(live.map(({ request }) => request), allowRetry);
        for (const [position, { index }] of live.entries()) results2[index] = sent[position];
      }
      return results2;
    }
    const payload = requests.map((request, index) => ({ index, methodname: request.methodname, args: request.args ?? {} }));
    const sentGeneration = this.authGeneration;
    const response = await fetchWithSession(`${this.baseUrl}${AJAX_SERVICE_PATH}?sesskey=${encodeURIComponent(this.sesskey ?? "")}&info=${requests.map((request) => request.methodname).join(",")}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${this.cookie.name}=${this.cookie.value}`
      },
      body: JSON.stringify(payload)
    }, this.baseUrl, this.cookie, this.fetchImpl);
    if (response.url.includes("/login/")) {
      if (this.onLoginRequired && allowRetry) {
        await this.reauthenticate(sentGeneration);
        return this.callBatchInternal(requests, false);
      }
      throw this.errors.api("Session expired", "servicerequireslogin");
    }
    const body = await response.json();
    const envelope = AjaxEnvelopeSchema.parse(body);
    const results = Array(requests.length).fill(void 0);
    for (const [position, item] of envelope.entries()) {
      const index = item.index ?? position;
      if (index >= requests.length || results[index] !== void 0) continue;
      results[index] = item.error ? {
        ok: false,
        error: this.errors.api(item.exception?.message ?? "Unknown API error", item.exception?.errorcode)
      } : { ok: true, data: item.data ?? item };
    }
    let learned = false;
    for (const [position, item] of envelope.entries()) {
      const name = requests[item.index ?? position]?.methodname;
      if (!name || !item.error || item.exception?.errorcode !== "servicenotavailable") continue;
      for (const listener of this.unavailableListeners) listener(name);
      if (this.unavailable.has(name)) continue;
      this.unavailable.add(name);
      learned = true;
    }
    if (learned) await this.writeCache();
    if (allowRetry && this.onLoginRequired && results.some((result) => result !== void 0 && !result.ok && this.errors.isLoginRequired(result.error))) {
      await this.reauthenticate(sentGeneration);
      return this.callBatchInternal(requests, false);
    }
    return results;
  }
  /** Whether the site is known to refuse name; telling the listeners it was gone around. */
  noteIfUnavailable(name) {
    if (!this.unavailable.has(name)) return false;
    for (const listener of this.unavailableListeners) listener(name);
    return true;
  }
  async ensureSession() {
    if (this.sesskey && this.userid) {
      return;
    }
    const html = await this.get(DASHBOARD_PATH);
    const context = parsePageContext(html, this.baseUrl);
    this.applyContext(context);
    await this.writeCache();
  }
  async get(pathname, params = {}) {
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString();
    return this.getAbsolute(`${this.baseUrl}${pathname}${query ? `?${query}` : ""}`);
  }
  async getAbsolute(url) {
    return (await this.requestAbsolute(url)).text();
  }
  async requestAbsoluteInternal(url, init, allowRetry, allowErrorStatus = false) {
    const sentGeneration = this.authGeneration;
    const response = await fetchWithSession(url, init, this.baseUrl, this.cookie, this.fetchImpl);
    if (response.url.includes("/login/")) {
      if (this.onLoginRequired && allowRetry) {
        await this.reauthenticate(sentGeneration);
        return this.requestAbsoluteInternal(url, init, false, allowErrorStatus);
      }
      throw this.errors.api("Session expired", "servicerequireslogin");
    }
    if (!response.ok && !allowErrorStatus) {
      const context = `HTTP ${response.status} loading ${safeUrl(url)}`;
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
        const moodleError = await response.text().then(parseMoodleErrorHtml).catch(() => null);
        if (moodleError) {
          throw this.errors.api(`${moodleError.message} (${context})`, moodleError.code);
        }
      }
      throw this.errors.api(context);
    }
    return response;
  }
  async getCoursesTimeline() {
    const courses = [];
    let offset = 0;
    while (true) {
      const data = await this.call(FUNC_GET_COURSES_BY_TIMELINE, { classification: "all", limit: 100, offset });
      if (!isRecord3(data) || !Array.isArray(data.courses) || !data.courses.length) {
        break;
      }
      courses.push(...data.courses);
      const nextOffset = typeof data.nextoffset === "number" ? data.nextoffset : offset;
      if (nextOffset <= offset || data.courses.length < 100) {
        break;
      }
      offset = nextOffset;
    }
    return parseCourses(courses);
  }
  async findActivity(activityId, courseId) {
    if (courseId !== void 0) {
      const activity = (await this.getActivities(courseId)).find((item) => item.id === activityId);
      if (activity) return activity;
      throw this.errors.notFound(`Activity ${activityId} was not found in course ${courseId}.`);
    }
    let unresolved = (await this.getCourses()).map((course) => course.id);
    let lastError;
    let searchedCourses = 0;
    const stateFallbacks = [];
    for (const courseIds of chunks(unresolved, ACTIVITY_SEARCH_BATCH_SIZE)) {
      const results = await this.callBatch(
        courseIds.map((id) => ({ methodname: FUNC_GET_COURSE_CONTENTS, args: { courseid: id } }))
      );
      for (const [index, id] of courseIds.entries()) {
        const result = results[index];
        if (!result?.ok) {
          if (!result) {
            stateFallbacks.push(id);
          } else if (this.errors.isLoginRequired(result.error)) {
            throw result.error;
          } else {
            lastError = result.error;
            if (result.error.moodleErrorCode === "servicenotavailable") stateFallbacks.push(id);
          }
          continue;
        }
        searchedCourses += 1;
        const activity = parseCourseContents(result.data).flatMap((section) => section.activities).find((item) => item.id === activityId);
        if (activity) return activity;
      }
    }
    const htmlFallbacks = [];
    unresolved = stateFallbacks;
    for (const courseIds of chunks(unresolved, ACTIVITY_SEARCH_BATCH_SIZE)) {
      const results = await this.callBatch(
        courseIds.map((id) => ({ methodname: FUNC_GET_COURSE_FORMAT_STATE, args: { courseid: id } }))
      );
      for (const [index, id] of courseIds.entries()) {
        const result = results[index];
        if (!result?.ok) {
          if (!result) {
            htmlFallbacks.push(id);
          } else if (this.errors.isLoginRequired(result.error)) {
            throw result.error;
          } else {
            lastError = result.error;
            if (result.error.moodleErrorCode === "servicenotavailable") htmlFallbacks.push(id);
          }
          continue;
        }
        const sections = parseCourseFormatState(result.data, this.baseUrl);
        if (!sections.length) {
          htmlFallbacks.push(id);
          continue;
        }
        searchedCourses += 1;
        const activity = sections.flatMap((section) => section.activities).find((item) => item.id === activityId);
        if (activity) return activity;
      }
    }
    for (const id of htmlFallbacks) {
      try {
        const activity = (await this.scrapeCourseContents(
          id,
          await this.get(COURSE_PATH, { id })
        )).flatMap((section) => section.activities).find((item) => item.id === activityId);
        searchedCourses += 1;
        if (activity) return activity;
      } catch (error) {
        if (this.errors.isLoginRequired(error)) throw error;
        lastError = error;
      }
    }
    if (!searchedCourses && lastError) throw lastError;
    throw this.errors.notFound(`Activity ${activityId} was not found in the authenticated user's courses.`);
  }
  async scrapeCourseContents(courseId, rootHtml) {
    const pages = [rootHtml];
    for (const section of parseCourseSectionNumbers(rootHtml, courseId)) {
      if (section !== 0) {
        pages.push(await this.get(COURSE_PATH, { id: courseId, section }));
      }
    }
    const seen = /* @__PURE__ */ new Set();
    const sections = [];
    for (const html of pages) {
      for (const section of parseCourseContentsHtml(html, this.baseUrl)) {
        const key = section.id ? `id:${section.id}` : `number:${section.section}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        sections.push(section);
      }
    }
    return sections;
  }
  reauthenticate(sentGeneration) {
    if (sentGeneration !== this.authGeneration) return Promise.resolve();
    if (!this.reauthInFlight) {
      const pending = this.performReauthentication().finally(() => {
        if (this.reauthInFlight === pending) this.reauthInFlight = void 0;
      });
      this.reauthInFlight = pending;
    }
    return this.reauthInFlight;
  }
  async performReauthentication() {
    if (!this.onLoginRequired) {
      throw this.errors.api("Session expired", "servicerequireslogin");
    }
    await this.clearSessionCache?.();
    const auth = await this.onLoginRequired();
    this.cookie = auth.cookie;
    this.applyContext(auth.pageContext);
    this.authGeneration += 1;
    await this.writeCache();
  }
  applyContext(context) {
    this.sesskey = context.sesskey;
    this.userid = context.user_info.userid;
    this.userInfo = context.user_info;
  }
  async writeCache() {
    if (this.writeSessionCache && this.sesskey && this.userid) {
      try {
        await this.writeSessionCache({
          baseUrl: this.baseUrl,
          cookieName: this.cookie.name,
          cookieSource: this.cookie.source,
          cookieValue: this.cookie.value,
          sesskey: this.sesskey,
          userid: this.userid,
          ...this.unavailable.size ? { unavailable: [...this.unavailable].sort() } : {},
          ...this.userInfo?.fullname ? { user: this.userInfo } : {}
        });
      } catch {
        return;
      }
    }
  }
};
function placeholderUserInfo(baseUrl, userid) {
  return {
    userid,
    username: "",
    fullname: "",
    sitename: "",
    siteurl: baseUrl,
    lang: ""
  };
}
function parseTodoPayload(value) {
  return parseTodoItems(isRecord3(value) && Array.isArray(value.events) ? value.events : []);
}
function errorMessage(value) {
  return value instanceof Error ? value.message : "Unknown Moodle error";
}
function chunks(values, size2) {
  const result = [];
  for (let index = 0; index < values.length; index += size2) {
    result.push(values.slice(index, index + size2));
  }
  return result;
}
function isRecord3(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isLoginErrorCode(code) {
  return ["servicerequireslogin", "sitepolicynotagreed"].includes(code ?? "");
}
function safeUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/(?:auth|credential|key|secret|sess|signature|token)/iu.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return "the requested Moodle URL";
  }
}

// src/grades.ts
function hasGrade(grade) {
  return Boolean(grade.trim() && !/^[\s–—−-]+$/u.test(grade));
}
function pageGradeReports(reports, limit, offset) {
  let matched = 0, returned = 0;
  const pages = reports.map((report) => {
    const start = Math.max(0, offset - matched);
    matched += report.items.length;
    const items = report.items.slice(start, start + limit - returned);
    returned += items.length;
    return { ...report, items };
  });
  return { pages, matched, returned, offset, has_more: offset + returned < matched };
}
export {
  MoodleClientCore,
  hasGrade,
  pageGradeReports,
  parseSavedDocumentHtml,
  resolveSection,
  searchSections,
  withChildSections
};
