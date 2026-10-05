// src/ed/client.ts
var EdApiError = class extends Error {
  kind;
  statusCode;
  constructor(kind, statusCode, message) {
    super(message);
    this.kind = kind;
    this.name = "EdApiError";
    this.statusCode = statusCode;
  }
};
var EdAuthExpiredError = class extends EdApiError {
  constructor(statusCode, message) {
    super("auth_expired", statusCode, message);
    this.name = "EdAuthExpiredError";
  }
};
var RETRYABLE_STATUS = /* @__PURE__ */ new Set([429, 502, 503, 504]);
var USER_CACHE_TTL_MS = 6e4;
var EdClient = class {
  cachedUser;
  apiBaseUrl;
  fetch;
  maxRetries;
  retryBaseDelayMs;
  sleep;
  token;
  timeoutMs;
  trace;
  constructor(options) {
    this.apiBaseUrl = ensureTrailingSlash(
      options.apiBaseUrl ?? readEnvironmentValue("EDSTEM_BASE_URL") ?? "https://edstem.org/api/"
    );
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1e3;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 15e3;
    this.trace = options.trace;
  }
  async fetchCourseThread(courseId, number) {
    const data = await this.get(`courses/${courseId}/threads/${number}`);
    const users = buildUsersMap(asArray(data.users));
    return parseThread(asRecord(data.thread ?? data), users);
  }
  async fetchLesson(lessonId, options = {}) {
    const data = await this.get(
      `lessons/${lessonId}`,
      options.view ? { view: "1" } : void 0
    );
    return parseLesson(asRecord(data.lesson ?? data));
  }
  async fetchSlide(slideId, options = {}) {
    const data = await this.get(
      `lessons/slides/${slideId}`,
      options.view ? { view: "1" } : void 0
    );
    return parseLessonSlide(asRecord(data.slide ?? data));
  }
  async fetchFile(url) {
    const target = new URL(url);
    if (!isDownloadableLessonFileUrl(target)) {
      throw new EdApiError(
        "api",
        0,
        "Only HTTPS files hosted on edusercontent.com can be downloaded automatically."
      );
    }
    let response;
    try {
      response = await this.fetch(target, {
        headers: { Accept: "*/*" },
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(this.timeoutMs, 12e4))
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new EdApiError("network", 0, `Failed to download the Ed file: ${detail}`);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new EdApiError("upstream", response.status, "Ed file downloads cannot redirect.");
    }
    if (!response.ok) {
      throw new EdApiError(
        "upstream",
        response.status,
        `Ed file download failed (HTTP ${response.status}).`
      );
    }
    return response;
  }
  async createThread(courseId, input) {
    const data = await this.post(`courses/${courseId}/threads`, {
      jsonBody: {
        thread: {
          anonymous_comments: false,
          category: input.category ?? "",
          content: input.content,
          is_anonymous: Boolean(input.anonymous),
          is_megathread: false,
          is_pinned: false,
          is_private: Boolean(input.private),
          subcategory: "",
          subsubcategory: "",
          title: input.title,
          type: input.type
        }
      }
    });
    if (!data) {
      throw new EdApiError("upstream", 0, "Ed API returned an empty response.");
    }
    return parseThread(asRecord(data.thread ?? data));
  }
  async createThreadReply(threadId, input) {
    return this.createComment(`threads/${threadId}/comments`, input);
  }
  async createCommentReply(commentId, input) {
    return this.createComment(`comments/${commentId}/comments`, input);
  }
  async completeSlide(slideId) {
    await this.request("PUT", `lessons/slides/${slideId}/complete`, { allowEmpty: true });
  }
  async fetchLessons(courseId) {
    const data = await this.get(`courses/${courseId}/lessons`);
    const modules = asArray(data.modules).map((entry) => parseLessonModule(asRecord(entry)));
    const moduleNames = new Map(modules.map((module) => [module.id, module.name]));
    const lessons = asArray(data.lessons).map(
      (entry) => parseLesson(asRecord(entry), moduleNames)
    );
    return { lessons, modules };
  }
  async fetchSlideQuestionResponses(slideId) {
    const data = await this.get(`lessons/slides/${slideId}/questions/responses`);
    return asArray(data.responses).map(
      (entry) => parseLessonQuestionResponse(asRecord(entry))
    );
  }
  async fetchSlideQuestions(slideId) {
    const data = await this.get(`lessons/slides/${slideId}/questions`);
    return asArray(data.questions).map((entry) => parseLessonQuestion(asRecord(entry)));
  }
  async fetchThread(threadId) {
    const data = await this.get(`threads/${threadId}`);
    const users = buildUsersMap(asArray(data.users));
    return parseThread(asRecord(data.thread ?? data), users);
  }
  async fetchThreads(courseId, options = {}) {
    const data = await this.get(`courses/${courseId}/threads`, {
      limit: String(Math.min(options.limit ?? 30, 100)),
      offset: String(options.offset ?? 0),
      sort: options.sort ?? "new"
    });
    const threads = Array.isArray(data.threads) ? data.threads : Array.isArray(data) ? data : [];
    return threads.map((entry) => parseThread(asRecord(entry)));
  }
  async fetchUser() {
    if (this.cachedUser && this.cachedUser.expiresAt > Date.now()) {
      return this.cachedUser.value;
    }
    const value = this.requestUser();
    this.cachedUser = { expiresAt: Date.now() + USER_CACHE_TTL_MS, value };
    value.catch(() => {
      if (this.cachedUser?.value === value) this.cachedUser = void 0;
    });
    return value;
  }
  async fetchUserActivity(userId, options = {}) {
    const params = {
      filter: options.filterType ?? "all",
      limit: String(Math.min(options.limit ?? 30, 50)),
      offset: String(options.offset ?? 0)
    };
    if (options.courseId) {
      params.course_id = String(options.courseId);
    }
    const data = await this.get(`users/${userId}/profile/activity`, params);
    return asArray(data.items);
  }
  async submitSlide(slideId) {
    const data = await this.post(`lessons/slides/${slideId}/questions/submit_all`, {
      allowEmpty: true,
      jsonBody: {}
    });
    if (!data) {
      return { submitted: true };
    }
    return {
      submitted: Boolean(data.submitted)
    };
  }
  async submitSlideAnswer(questionId, choices, options = {}) {
    const data = await this.post(`lessons/slides/questions/${questionId}/responses`, {
      jsonBody: choices,
      params: options.amend ? { amend: "1" } : void 0
    });
    if (!data) {
      throw new EdApiError("upstream", 0, "Ed API returned an empty response.");
    }
    return {
      correct: typeof data.correct === "boolean" ? data.correct : null,
      explanation: data.explanation ?? null,
      slideCompleted: Boolean(data.slide_completed),
      solution: data.solution ?? null
    };
  }
  async requestUser() {
    const data = await this.get("user");
    const userData = asRecord(data.user);
    const user = parseUser(userData);
    const courses = asArray(data.courses).map((enrollment) => {
      const record = asRecord(enrollment);
      const course = asRecord(record.course);
      const role = asRecord(record.role);
      return parseCourse(course, asString(role.role));
    });
    return { courses, user };
  }
  async createComment(path, input) {
    const data = await this.post(path, {
      jsonBody: {
        comment: {
          content: input.content,
          is_anonymous: Boolean(input.anonymous),
          is_private: Boolean(input.private),
          type: input.type
        }
      }
    });
    if (!data) {
      throw new EdApiError("upstream", 0, "Ed API returned an empty response.");
    }
    return parseComment(asRecord(data.comment ?? data));
  }
  async get(path, params) {
    const payload = await this.request("GET", path, { params });
    return payload ?? {};
  }
  async post(path, options = {}) {
    return this.request("POST", path, options);
  }
  async request(method, path, options = {}) {
    const url = new URL(path.replace(/^\/+/, ""), this.apiBaseUrl);
    for (const [key, value] of Object.entries(options.params ?? {})) {
      url.searchParams.set(key, value);
    }
    let response = await this.send(method, url, options.jsonBody);
    for (let attempt = 0; method === "GET" && attempt < this.maxRetries && RETRYABLE_STATUS.has(response.status); attempt += 1) {
      await this.sleep(retryDelayMs(response, attempt, this.retryBaseDelayMs));
      response = await this.send(method, url, options.jsonBody);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "an unknown location";
      throw new EdApiError(
        "base_url",
        response.status,
        `Ed API base URL redirected to ${location}. Set EDSTEM_BASE_URL to a valid JSON API endpoint.`
      );
    }
    const rawBody = await response.text();
    const errorPayload = safeParseJson(rawBody) ?? {};
    const code = asString(errorPayload.code);
    const message = asString(errorPayload.message);
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      if (code === "bad_token" || response.status === 401) {
        throw new EdAuthExpiredError(
          response.status,
          `Authentication failed (HTTP ${response.status}). Check your Ed API token.`
        );
      }
      throw new EdApiError("api", response.status, formatApiError(response.status, message));
    }
    if (response.status === 404) {
      throw new EdApiError("api", response.status, message || `Not found: ${path}`);
    }
    if (!response.ok) {
      throw new EdApiError("upstream", response.status, formatApiError(response.status, message));
    }
    if (!rawBody.trim()) {
      if (options.allowEmpty) {
        return null;
      }
      throw new EdApiError(
        "base_url",
        response.status,
        "Ed API returned a non-JSON response. Set EDSTEM_BASE_URL to a valid JSON API endpoint."
      );
    }
    const payload = safeParseJson(rawBody);
    if (!payload) {
      throw new EdApiError(
        "base_url",
        response.status,
        "Ed API returned a non-JSON response. Set EDSTEM_BASE_URL to a valid JSON API endpoint."
      );
    }
    return payload;
  }
  async send(method, url, jsonBody) {
    const startedAt = Date.now();
    try {
      const response = await this.fetch(url, {
        body: jsonBody === void 0 ? void 0 : JSON.stringify(jsonBody),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...jsonBody === void 0 ? {} : { "Content-Type": "application/json" }
        },
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      this.trace?.({ method, url: url.toString(), status: response.status, ms: Date.now() - startedAt });
      return response;
    } catch (error) {
      this.trace?.({ method, url: url.toString(), status: 0, ms: Date.now() - startedAt });
      const detail = error instanceof Error ? error.message : String(error);
      throw new EdApiError("network", 0, `Failed to reach the Ed API: ${detail}`);
    }
  }
};
function retryDelayMs(response, attempt, baseDelayMs) {
  const backoffMs = baseDelayMs * 2 ** attempt;
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1e3 : 0;
  return Math.max(backoffMs, retryAfterMs);
}
function readEnvironmentValue(name) {
  return typeof process === "undefined" ? void 0 : process.env[name];
}
function safeParseJson(rawBody) {
  try {
    return asRecord(JSON.parse(rawBody));
  } catch {
    return null;
  }
}
function formatApiError(statusCode, message) {
  if (message) {
    return `Ed API error (HTTP ${statusCode}): ${message}`;
  }
  return `Ed API error (HTTP ${statusCode})`;
}
function buildUsersMap(entries) {
  return new Map(
    entries.map((entry) => parseUser(asRecord(entry))).filter((user) => user.id > 0).map((user) => [user.id, user])
  );
}
function parseUser(data) {
  return {
    avatar: asString(data.avatar),
    courseRole: asString(data.course_role),
    email: asString(data.email),
    id: asInt(data.id),
    name: asString(data.name),
    role: asString(data.role)
  };
}
function parseCourse(data, role = "") {
  return {
    code: asString(data.code),
    id: asInt(data.id),
    name: asString(data.name),
    role,
    session: asString(data.session),
    status: asString(data.status),
    year: asString(data.year)
  };
}
function parseLessonModule(data) {
  return {
    courseId: asInt(data.course_id),
    createdAt: asString(data.created_at),
    id: asInt(data.id),
    name: asString(data.name),
    updatedAt: asString(data.updated_at),
    userId: asInt(data.user_id)
  };
}
function parseLessonSlide(data) {
  const slideData = asRecord(data.data);
  return {
    content: asString(data.content) || asString(data.passage) || asString(slideData.content) || asString(slideData.passage),
    courseId: asInt(data.course_id),
    fileUrl: asString(data.file_url),
    id: asInt(data.id),
    index: asInt(data.index),
    isHidden: Boolean(data.is_hidden),
    lessonId: asInt(data.lesson_id),
    status: asString(data.status),
    title: asString(data.title),
    type: asString(data.type)
  };
}
function isDownloadableLessonFileUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return url.protocol === "https:" && (url.hostname === "edusercontent.com" || url.hostname.endsWith(".edusercontent.com"));
  } catch {
    return false;
  }
}
function parseLessonQuestion(data) {
  const question = asRecord(data.data);
  return {
    answers: asArray(question.answers).map((value) => asString(value)),
    content: asString(question.content),
    explanation: asString(question.explanation),
    id: asInt(data.id),
    index: asInt(data.index),
    isAssessed: Boolean(question.assessed),
    isFormatted: Boolean(question.formatted),
    lessonMarkableId: asInt(data.lesson_markable_id),
    multipleSelection: Boolean(question.multiple_selection),
    slideId: asInt(data.lesson_slide_id),
    solution: asArray(question.solution).map((value) => asInt(value)),
    type: asString(question.type)
  };
}
function parseLessonQuestionResponse(data) {
  const correct = data.correct;
  return {
    correct: typeof correct === "boolean" ? correct : null,
    createdAt: asString(data.created_at),
    data: data.data ?? null,
    questionId: asInt(data.question_id),
    userId: asInt(data.user_id)
  };
}
function parseLesson(data, moduleNames = /* @__PURE__ */ new Map()) {
  const moduleId = asInt(data.module_id);
  return {
    availableAt: asString(data.effective_available_at) || asString(data.available_at),
    courseId: asInt(data.course_id),
    createdAt: asString(data.created_at),
    dueAt: asString(data.effective_due_at) || asString(data.due_at),
    id: asInt(data.id),
    isHidden: Boolean(data.is_hidden),
    isTimed: Boolean(data.is_timed),
    isUnlisted: Boolean(data.is_unlisted),
    kind: asString(data.kind),
    lockedAt: asString(data.effective_locked_at) || asString(data.locked_at),
    moduleId,
    moduleName: asString(data.module_name) || moduleNames.get(moduleId) || "",
    number: asInt(data.number),
    openable: Boolean(data.openable),
    openableWithoutAttempt: Boolean(data.openable_without_attempt),
    outline: asString(data.outline),
    slideCount: asInt(data.slide_count),
    slides: asArray(data.slides).map((entry) => parseLessonSlide(asRecord(entry))),
    solutionsAt: asString(data.effective_solutions_at) || asString(data.solutions_at),
    state: asString(data.state),
    status: asString(data.status),
    title: asString(data.title),
    type: asString(data.type),
    updatedAt: asString(data.updated_at)
  };
}
function parseThread(data, usersMap = /* @__PURE__ */ new Map()) {
  const userId = asInt(data.user_id);
  return {
    answers: asArray(data.answers).map((entry) => parseComment(asRecord(entry), usersMap)),
    category: asString(data.category),
    author: usersMap.get(userId) ?? null,
    comments: asArray(data.comments).map((entry) => parseComment(asRecord(entry), usersMap)),
    content: asString(data.content),
    courseId: asInt(data.course_id),
    createdAt: asString(data.created_at),
    document: asString(data.document),
    id: asInt(data.id),
    isAnonymous: Boolean(data.is_anonymous),
    isAnswered: Boolean(data.is_answered),
    isEndorsed: Boolean(data.is_endorsed),
    isLocked: Boolean(data.is_locked),
    isPinned: Boolean(data.is_pinned),
    isPrivate: Boolean(data.is_private),
    // Ed omits read state on some payloads; only an explicit false means unseen.
    isSeen: data.is_seen !== false,
    number: asInt(data.number),
    metrics: parseThreadMetrics(data),
    subcategory: asString(data.subcategory),
    subsubcategory: asString(data.subsubcategory),
    title: asString(data.title),
    type: asString(data.type),
    updatedAt: asString(data.updated_at),
    userId
  };
}
function parseThreadMetrics(data) {
  return {
    flagCount: asInt(data.flag_count),
    newReplyCount: asInt(data.new_reply_count),
    replyCount: asInt(data.reply_count),
    starCount: asInt(data.star_count),
    unresolvedCount: asInt(data.unresolved_count),
    uniqueViewCount: asInt(data.unique_view_count),
    viewCount: asInt(data.view_count),
    voteCount: asInt(data.vote_count)
  };
}
function parseComment(data, usersMap = /* @__PURE__ */ new Map()) {
  const userId = asInt(data.user_id);
  return {
    author: usersMap.get(userId) ?? null,
    comments: asArray(data.comments).map((entry) => parseComment(asRecord(entry), usersMap)),
    content: asString(data.content),
    createdAt: asString(data.created_at),
    document: asString(data.document),
    id: asInt(data.id),
    isAnonymous: Boolean(data.is_anonymous),
    isEndorsed: Boolean(data.is_endorsed),
    isResolved: Boolean(data.is_resolved),
    type: asString(data.type),
    userId,
    voteCount: asInt(data.vote_count)
  };
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function asInt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return Number.parseInt(String(value ?? 0), 10) || 0;
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function asString(value) {
  return typeof value === "string" ? value : "";
}
function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

// src/ed/files.ts
import { parse } from "node-html-parser";
function listLessonFiles(lesson) {
  const files = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (file) => {
    const key = `${file.slideId ?? "lesson"}\0${file.url}`;
    if (!isDownloadableLessonFileUrl(file.url) || seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };
  for (const file of filesFromContent(lesson.outline, { lessonId: lesson.id, source: "content" })) {
    add(file);
  }
  for (const slide of lesson.slides) {
    if (slide.fileUrl) {
      add({
        filename: suggestedSlideFilename(slide),
        lessonId: lesson.id,
        mediaType: mediaTypeForSlide(slide),
        slideId: slide.id,
        slideIndex: slide.index,
        slideTitle: slide.title,
        source: "slide",
        url: slide.fileUrl
      });
    }
    for (const file of filesFromContent(slide.content, slideOwner(lesson, slide))) add(file);
  }
  return files;
}
function listThreadFiles(thread) {
  const files = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (file) => {
    if (!isDownloadableLessonFileUrl(file.url) || seen.has(file.url)) return;
    seen.add(file.url);
    files.push(file);
  };
  for (const file of filesFromContent(thread.content, { threadId: thread.id, source: "thread" })) {
    add(file);
  }
  const walk = (comments) => {
    for (const comment of comments) {
      const owner = { threadId: thread.id, commentId: comment.id, source: "comment" };
      for (const file of filesFromContent(comment.content, owner)) add(file);
      walk(comment.comments);
    }
  };
  walk(thread.answers);
  walk(thread.comments);
  return files;
}
function slideOwner(lesson, slide) {
  return {
    lessonId: lesson.id,
    slideId: slide.id,
    slideIndex: slide.index,
    slideTitle: slide.title,
    source: "content"
  };
}
function filesFromContent(source, owner) {
  if (!source || !/<file\b/i.test(source)) return [];
  return parse(source, { lowerCaseTagName: true }).querySelectorAll("file").map((node) => fileFromNode(node, owner)).filter((file) => file !== null);
}
function fileFromNode(node, owner) {
  const url = node.getAttribute("url")?.trim() ?? "";
  if (!url) return null;
  const filename = node.getAttribute("filename")?.trim() || node.getAttribute("name")?.trim() || filenameFromUrl(url) || "download";
  return { filename, ...owner, url };
}
function suggestedSlideFilename(slide) {
  const base = slide.title.trim() || `slide-${slide.id}`;
  const extension = slide.type.toLowerCase() === "pdf" ? ".pdf" : "";
  return extension && !base.toLowerCase().endsWith(extension) ? `${base}${extension}` : base;
}
function mediaTypeForSlide(slide) {
  return slide.type.toLowerCase() === "pdf" ? "application/pdf" : void 0;
}
function filenameFromUrl(value) {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "");
  } catch {
    return "";
  }
}

// src/ed/filter.ts
var RELATIVE_SINCE = /^(\d+)\s*([dhw])$/i;
var RELATIVE_UNIT_MS = {
  d: 864e5,
  h: 36e5,
  w: 6048e5
};
function filterThreads(threads, options = {}) {
  const answered = options.answered;
  const category = normalizeFilter(options.category);
  const subcategory = normalizeFilter(options.subcategory);
  const threadType = normalizeFilter(options.threadType);
  const words = queryWords(options.query);
  const since = options.since?.getTime();
  return threads.filter((thread) => {
    if (category && normalizeFilter(thread.category) !== category) {
      return false;
    }
    if (subcategory && normalizeFilter(thread.subcategory) !== subcategory) {
      return false;
    }
    if (threadType && normalizeFilter(thread.type) !== threadType) {
      return false;
    }
    if (answered !== void 0 && thread.isAnswered !== answered) {
      return false;
    }
    if (since !== void 0) {
      const created = createdAt(thread);
      if (created === void 0 || created < since) {
        return false;
      }
    }
    if (words.length > 0 && !matchesQuery(thread, words)) {
      return false;
    }
    return true;
  });
}
function hasThreadFilters(options) {
  return options.answered !== void 0 || options.since !== void 0 || Boolean(normalizeFilter(options.category)) || Boolean(normalizeFilter(options.subcategory)) || Boolean(normalizeFilter(options.threadType)) || queryWords(options.query).length > 0;
}
function parseSince(value, now = /* @__PURE__ */ new Date()) {
  const normalized = value.trim();
  const relative = RELATIVE_SINCE.exec(normalized);
  if (relative) {
    const unit = RELATIVE_UNIT_MS[(relative[2] ?? "").toLowerCase()] ?? 0;
    return new Date(now.getTime() - Number(relative[1]) * unit);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid time value ${JSON.stringify(value)}. Use an ISO date such as 2026-09-01, an ISO datetime such as 2026-09-01T10:00:00Z, or a relative offset such as 7d, 12h, or 2w.`
    );
  }
  return parsed;
}
function isThreadOlderThan(thread, since) {
  const created = createdAt(thread);
  return created !== void 0 && created < since.getTime();
}
function matchesQuery(thread, words) {
  const haystack = `${thread.title}
${thread.document}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}
function queryWords(query) {
  return (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}
function createdAt(thread) {
  const created = Date.parse(thread.createdAt);
  return Number.isNaN(created) ? void 0 : created;
}
function normalizeFilter(value) {
  const normalized = value?.trim().toLowerCase();
  return normalized || void 0;
}

// src/ed/operations.ts
var THREAD_PAGE_CAP = 10;
var EdInputError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "EdInputError";
  }
};
var EdCourseNotFoundError = class extends EdInputError {
  constructor(message) {
    super(message);
    this.name = "EdCourseNotFoundError";
  }
};
async function listThreads(client, options) {
  assertPositive(options.limit, "--limit");
  const offset = options.offset ?? 0;
  assertNonNegative(offset, "--offset");
  const courseId = await resolveCourseId(client, options.courseId);
  if (!hasThreadFilters(options)) {
    return client.fetchThreads(courseId, {
      limit: Math.min(options.limit, 100),
      offset,
      sort: options.sort
    });
  }
  const pageSize = Math.min(100, Math.max(options.limit, 30));
  const matches = [];
  for (let page = 0; page < THREAD_PAGE_CAP; page += 1) {
    const threads = await client.fetchThreads(courseId, {
      limit: pageSize,
      offset: offset + page * pageSize,
      sort: options.sort
    });
    matches.push(...filterThreads(threads, options));
    if (matches.length >= options.limit || threads.length < pageSize) {
      break;
    }
    if (options.sort === "new" && passedSince(threads, options.since)) {
      break;
    }
  }
  return matches.slice(0, options.limit);
}
function parseSinceValue(value) {
  try {
    return parseSince(value);
  } catch (error) {
    throw new EdInputError(error instanceof Error ? error.message : String(error));
  }
}
function passedSince(threads, since) {
  const oldest = threads.filter((thread) => !thread.isPinned).at(-1);
  return Boolean(since && oldest && isThreadOlderThan(oldest, since));
}
async function listLessons(client, courseReference, options = {}) {
  const courseId = await resolveCourseId(client, courseReference);
  const { lessons } = await client.fetchLessons(courseId);
  if (lessons.length === 0) {
    return [];
  }
  const moduleQuery = normalizeFilter2(options.module);
  const lessonTypeQuery = normalizeFilter2(options.lessonType);
  const stateQuery = normalizeFilter2(options.state);
  const statusQuery = normalizeFilter2(options.status);
  assertKnownModule(lessons, moduleQuery, options.module);
  assertKnownLessonValue(lessons, "type", lessonTypeQuery, options.lessonType);
  assertKnownLessonValue(lessons, "state", stateQuery, options.state);
  assertKnownLessonValue(lessons, "status", statusQuery, options.status);
  return lessons.filter(
    (lesson) => matchesModule(lesson, moduleQuery) && matchesLessonValue(lesson, "type", lessonTypeQuery) && matchesLessonValue(lesson, "state", stateQuery) && matchesLessonValue(lesson, "status", statusQuery)
  );
}
function normalizeFilter2(value) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== "all" ? normalized : void 0;
}
function assertKnownModule(lessons, query, input) {
  if (!query || lessons.some((lesson) => matchesModule(lesson, query))) {
    return;
  }
  const modules = /* @__PURE__ */ new Map();
  for (const lesson of lessons) {
    modules.set(lesson.moduleId, lesson.moduleName);
  }
  const available = [...modules].map(([id, name]) => `${id} (${name})`).join(", ");
  throw unknownLessonFilter("module", input, available);
}
function assertKnownLessonValue(lessons, field, query, input) {
  if (!query || lessons.some((lesson) => matchesLessonValue(lesson, field, query))) {
    return;
  }
  const available = [...new Set(lessons.map((lesson) => lesson[field]).filter(Boolean))].sort((left, right) => left.localeCompare(right)).join(", ");
  throw unknownLessonFilter(field, input, available);
}
function matchesModule(lesson, query) {
  return !query || String(lesson.moduleId) === query || lesson.moduleName.toLowerCase().includes(query);
}
function matchesLessonValue(lesson, field, query) {
  return !query || lesson[field].toLowerCase() === query;
}
function unknownLessonFilter(field, input, available) {
  return new EdInputError(
    `Unknown lesson ${field} ${JSON.stringify(input?.trim())}. Available values: ${available}. Use "all" or omit the filter to include every value.`
  );
}
async function resolveCourseId(client, reference) {
  const id = directCourseId(reference);
  if (id !== void 0) {
    return id;
  }
  const { courses } = await client.fetchUser();
  return resolveCourseIdFromCourses(reference, courses);
}
async function resolveCourse(client, reference) {
  const { courses } = await client.fetchUser();
  const id = directCourseId(reference);
  if (id !== void 0) {
    const course = courses.find((candidate) => candidate.id === id);
    if (course) return course;
    throw new EdCourseNotFoundError(`Unknown course ID ${id}.`);
  }
  return resolveCourseCode(reference, courses);
}
function resolveCourseIdFromCourses(reference, courses) {
  const id = directCourseId(reference);
  if (id !== void 0) {
    return id;
  }
  return resolveCourseCode(reference, courses).id;
}
function resolveCourseCode(reference, courses) {
  const query = String(reference).trim().toLowerCase();
  const tiers = [
    (course) => lower(course.code) === query,
    (course) => firstToken(course.code) === query,
    (course) => lower(course.name) === query,
    (course) => lower(course.code).includes(query) || lower(course.name).includes(query)
  ];
  for (const matches of tiers.map((tier) => courses.filter(tier))) {
    if (matches.length === 0) continue;
    const sorted = [...matches].sort((left, right) => left.id - right.id);
    if (sorted.length === 1 && sorted[0]) return sorted[0];
    throw new EdInputError(
      `Unit ${JSON.stringify(String(reference).trim())} is ambiguous. Matching units: ${sorted.map(formatCourseChoice).join(", ")}. Use a unit ID.`
    );
  }
  const available = courses.map(formatCourseName).filter(Boolean).join(", ");
  throw new EdCourseNotFoundError(
    `No unit matches ${JSON.stringify(String(reference).trim())}. Your units: ${available || "none"}.`
  );
}
function lower(value) {
  return (value ?? "").toLowerCase();
}
function firstToken(code) {
  return lower(code).trim().split(/\s+/u)[0] ?? "";
}
function formatCourseName(course) {
  return course.code || course.name || String(course.id);
}
function formatCourseChoice(course) {
  const details = [course.code, course.year, course.session, course.status].filter(Boolean).join(", ");
  return details ? `${course.id} (${details})` : String(course.id);
}
function directCourseId(reference) {
  if (typeof reference === "number") {
    assertPositive(reference, "course ID");
    return reference;
  }
  const value = reference.trim();
  if (!value) {
    throw new EdInputError("Course ID or code must not be empty");
  }
  if (!/^\d+$/.test(value)) {
    return void 0;
  }
  const id = Number(value);
  assertPositive(id, "course ID");
  return id;
}
function assertPositive(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new EdInputError(`${label} must be greater than 0`);
  }
}
function assertNonNegative(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new EdInputError(`${label} must be greater than or equal to 0`);
  }
}

// src/ed/projections.ts
var STAFF_COURSE_ROLES = /* @__PURE__ */ new Set(["admin", "ta", "tutor"]);
var TIMESTAMP_FRACTION = /\.\d+(?=Z|[+-]\d{2}:\d{2}|$)/;
function projectUser(user, includePrivate = false) {
  const result = { id: user.id, name: user.name };
  setNonEmpty(result, "courseRole", user.courseRole);
  setNonEmpty(result, "role", user.role);
  setNonEmpty(result, "avatar", user.avatar);
  if (includePrivate) {
    setNonEmpty(result, "email", user.email);
  }
  return result;
}
function projectThreadSummary(thread) {
  const result = {
    id: thread.id,
    number: thread.number,
    title: thread.title,
    type: thread.type,
    category: thread.category,
    courseId: thread.courseId
  };
  setNonEmpty(result, "subcategory", thread.subcategory);
  setNonEmpty(result, "createdAt", normalizeTimestamp(thread.createdAt));
  setNonEmpty(result, "updatedAt", normalizeTimestamp(thread.updatedAt));
  setNonEmpty(result, "metrics", projectMetrics(thread.metrics));
  setNonEmpty(result, "flags", threadFlags(thread));
  return result;
}
function projectThreadDetail(thread, options = {}) {
  const users = collectUsers(thread);
  const result = {
    ...projectThreadSummary(thread),
    userId: thread.userId,
    document: thread.document
  };
  if (options.includeHtml) {
    setNonEmpty(result, "content", thread.content);
  }
  const endorsement = projectEndorsement(thread);
  setNonEmpty(result, "endorsement", endorsement);
  if (users.size > 0) {
    result.users = Object.fromEntries(
      [...users.entries()].sort(([left], [right]) => left - right).map(([id, user]) => [String(id), projectUser(user)])
    );
  }
  if (thread.answers.length > 0) {
    result.answers = thread.answers.map((comment) => projectComment(comment, options));
  }
  if (thread.comments.length > 0) {
    result.comments = thread.comments.map((comment) => projectComment(comment, options));
  }
  return result;
}
function projectComment(comment, options = {}) {
  const result = {
    id: comment.id,
    userId: comment.userId,
    document: comment.document
  };
  setNonEmpty(result, "createdAt", normalizeTimestamp(comment.createdAt));
  if (options.includeHtml) {
    setNonEmpty(result, "content", comment.content);
  }
  setNonZero(result, "voteCount", comment.voteCount);
  setTrue(result, "endorsed", comment.isEndorsed);
  setTrue(result, "anonymous", comment.isAnonymous);
  setTrue(result, "resolved", comment.isResolved);
  setTrue(result, "byStaff", isStaff(comment.author));
  if (comment.comments.length > 0) {
    result.comments = comment.comments.map((child) => projectComment(child, options));
  }
  return result;
}
function collectUsers(thread) {
  const users = /* @__PURE__ */ new Map();
  rememberUser(users, thread.userId, thread.author);
  collectCommentUsers(users, thread.answers);
  collectCommentUsers(users, thread.comments);
  return users;
}
function collectCommentUsers(users, comments) {
  for (const comment of comments) {
    rememberUser(users, comment.userId, comment.author);
    collectCommentUsers(users, comment.comments);
  }
}
function rememberUser(users, id, user) {
  if (id <= 0 || users.has(id)) {
    return;
  }
  users.set(
    id,
    user ?? { id, name: "", email: "", role: "", courseRole: "", avatar: "" }
  );
}
function projectMetrics(metrics) {
  const result = {};
  setNonZero(result, "voteCount", metrics.voteCount);
  setNonZero(result, "viewCount", metrics.viewCount);
  setNonZero(result, "replyCount", metrics.replyCount);
  setNonZero(result, "newReplyCount", metrics.newReplyCount);
  setNonZero(result, "starCount", metrics.starCount);
  return result;
}
function threadFlags(thread) {
  return [
    thread.isPinned ? "pinned" : "",
    thread.isPrivate ? "private" : "",
    thread.isAnswered ? "answered" : "",
    thread.isEndorsed ? "endorsed" : "",
    thread.isAnonymous ? "anonymous" : "",
    thread.isLocked ? "locked" : "",
    thread.isSeen ? "" : "unseen"
  ].filter(Boolean);
}
function projectEndorsement(thread) {
  const endorsedAnswerIds = [];
  let staffReplyCount = 0;
  const visit = (comment) => {
    if (comment.isEndorsed) {
      endorsedAnswerIds.push(comment.id);
    }
    if (isStaff(comment.author)) {
      staffReplyCount += 1;
    }
    comment.comments.forEach(visit);
  };
  thread.answers.forEach(visit);
  thread.comments.forEach(visit);
  const result = {};
  setNonEmpty(result, "endorsedAnswerIds", endorsedAnswerIds);
  setNonZero(result, "staffReplyCount", staffReplyCount);
  setTrue(result, "hasStaffAnswer", staffReplyCount > 0);
  return result;
}
function isStaff(user) {
  return Boolean(user && STAFF_COURSE_ROLES.has(user.courseRole));
}
function normalizeTimestamp(value) {
  return value.replace(TIMESTAMP_FRACTION, "");
}
function setNonEmpty(target, key, value) {
  if (value === "" || value === null || value === void 0) {
    return;
  }
  if (Array.isArray(value) && value.length === 0) {
    return;
  }
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
    return;
  }
  target[key] = value;
}
function setTrue(target, key, value) {
  if (value) {
    target[key] = true;
  }
}
function setNonZero(target, key, value) {
  if (value !== 0) {
    target[key] = value;
  }
}

// src/markdown.ts
import { HTMLElement as HTMLElement2, parse as parse2 } from "node-html-parser";
var ED_XML_TAG = /<(?:document|paragraph|heading|list|list-item|link|file|break|code|pre)\b/i;
function threadToMarkdown(thread) {
  const lines = [`# #${thread.number} ${thread.title}`, ""];
  addMetadata(lines, "Thread ID", thread.id);
  addMetadata(lines, "Course ID", thread.courseId);
  addMetadata(lines, "Author", authorName(thread.author, thread.isAnonymous));
  addMetadata(lines, "Category", [thread.category, thread.subcategory].filter(Boolean).join(" / "));
  addMetadata(lines, "Created", thread.createdAt);
  addMetadata(lines, "Updated", thread.updatedAt);
  addMetadata(lines, "Flags", threadFlags2(thread).join(", "));
  lines.push("", "## Post", "", renderEdText(thread.document || thread.content), "");
  appendComments(lines, "Answers", thread.answers);
  appendComments(lines, "Comments", thread.comments);
  return `${lines.join("\n").trimEnd()}
`;
}
function lessonToMarkdown(lesson) {
  const lines = [`# ${lesson.title}`, ""];
  addMetadata(lines, "Lesson ID", lesson.id);
  addMetadata(lines, "Course ID", lesson.courseId);
  addMetadata(lines, "Module", lesson.moduleName);
  addMetadata(lines, "Type", lesson.type);
  addMetadata(lines, "Status", lesson.status);
  if (lesson.outline) {
    lines.push("", "## Outline", "", renderEdText(lesson.outline, 2), "");
  }
  lines.push("", "## Slides", "");
  for (const slide of lesson.slides) {
    lines.push(`### ${slide.index || 1}. ${slideTitle(slide)}`, "");
    addMetadata(lines, "Slide ID", slide.id);
    addMetadata(lines, "Type", slide.type);
    addMetadata(lines, "Status", slide.status);
    if (slide.content) {
      lines.push("", renderEdText(slide.content, 2), "");
    }
  }
  return `${lines.join("\n").trimEnd()}
`;
}
function slideToMarkdown(slide) {
  const lines = [`# ${slideTitle(slide)}`, ""];
  addMetadata(lines, "Slide ID", slide.id);
  addMetadata(lines, "Lesson ID", slide.lessonId);
  addMetadata(lines, "Course ID", slide.courseId);
  addMetadata(lines, "Index", slide.index);
  addMetadata(lines, "Type", slide.type);
  addMetadata(lines, "Status", slide.status);
  if (slide.fileUrl) {
    lines.push("", `File: [${slideTitle(slide)}](${slide.fileUrl})`);
  }
  if (slide.content) {
    lines.push("", renderEdText(slide.content));
  }
  return `${lines.join("\n").trimEnd()}
`;
}
function renderEdText(source, headingOffset = 0) {
  if (!ED_XML_TAG.test(source)) {
    return source;
  }
  if (/<document\b/i.test(source) && !/<\/document>/i.test(source)) {
    return source;
  }
  try {
    const normalized = source.replace(/<link\b/gi, "<a").replace(/<\/link>/gi, "</a>");
    const root = parse2(normalized, { lowerCaseTagName: true });
    return renderChildren(root, headingOffset).replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return source;
  }
}
function renderNode(node, headingOffset) {
  if (!(node instanceof HTMLElement2)) {
    return node.textContent;
  }
  const tag = node.rawTagName.toLowerCase();
  const content = renderChildren(node, headingOffset);
  if (tag === "document") return content;
  if (tag === "paragraph") return `${content.trim()}

`;
  if (tag === "break" || tag === "br") return "\n";
  if (tag === "heading") {
    const level = Math.min(6, Math.max(1, Number(node.getAttribute("level")) || 1) + headingOffset);
    return `${"#".repeat(level)} ${content.trim()}

`;
  }
  if (tag === "list") return renderList(node, headingOffset);
  if (tag === "list-item") return content;
  if (tag === "link" || tag === "a") {
    const href = node.getAttribute("href") ?? node.getAttribute("url") ?? "";
    return href ? `[${content.trim() || href}](${href})` : content;
  }
  if (tag === "file") {
    const url = node.getAttribute("url") ?? "";
    const name = node.getAttribute("filename") ?? node.getAttribute("name") ?? url;
    return url ? `File: [${name}](${url})

` : `File: ${name}

`;
  }
  if (tag === "code") return `\`${content.trim()}\``;
  if (tag === "pre") return `
\`\`\`
${node.textContent.trim()}
\`\`\`

`;
  if (tag === "bold" || tag === "strong") return `**${content.trim()}**`;
  if (tag === "italic" || tag === "em") return `*${content.trim()}*`;
  return content;
}
function renderChildren(node, headingOffset) {
  return node.childNodes.map((child) => renderNode(child, headingOffset)).join("");
}
function renderList(node, headingOffset) {
  const ordered = node.getAttribute("style") === "number" || node.getAttribute("type") === "ordered";
  const items = node.childNodes.filter(
    (child) => child instanceof HTMLElement2 && child.rawTagName.toLowerCase() === "list-item"
  );
  return `${items.map((item, index) => {
    const marker = ordered ? `${index + 1}.` : "-";
    const body = renderChildren(item, headingOffset).trim().replace(/\n/g, "\n  ");
    return `${marker} ${body}`;
  }).join("\n")}

`;
}
function appendComments(lines, title, comments) {
  if (comments.length === 0) return;
  lines.push(`## ${title}`, "");
  for (const comment of comments) {
    appendComment(lines, comment, 0);
  }
  lines.push("");
}
function appendComment(lines, comment, depth) {
  const indent = "  ".repeat(depth);
  const markers = [
    isStaff2(comment.author) ? "staff" : "",
    comment.isEndorsed ? "endorsed" : "",
    comment.isAnonymous ? "anonymous" : "",
    comment.voteCount ? `${comment.voteCount > 0 ? "+" : ""}${comment.voteCount}` : ""
  ].filter(Boolean);
  const suffix = markers.length ? ` [${markers.join(", ")}]` : "";
  const timestamp = comment.createdAt ? ` - ${comment.createdAt}` : "";
  lines.push(`${indent}- **${authorName(comment.author, comment.isAnonymous)}**${suffix}${timestamp}`);
  const body = renderEdText(comment.document || comment.content);
  if (body) {
    for (const line of body.split("\n")) {
      lines.push(`${indent}  ${line}`);
    }
  }
  comment.comments.forEach((child) => appendComment(lines, child, depth + 1));
}
function addMetadata(lines, label, value) {
  if (value !== "" && value !== 0) {
    lines.push(`- **${label}:** ${value}`);
  }
}
function slideTitle(slide) {
  return slide.title || `Slide ${slide.index || 1}`;
}
function authorName(user, anonymous) {
  if (anonymous) return "Anonymous";
  return user?.name || "Unknown";
}
function isStaff2(user) {
  return Boolean(user && ["admin", "ta", "tutor"].includes(user.courseRole));
}
function threadFlags2(thread) {
  return [
    thread.isPinned ? "pinned" : "",
    thread.isPrivate ? "private" : "",
    thread.isAnswered ? "answered" : "",
    thread.isEndorsed ? "endorsed" : "",
    thread.isAnonymous ? "anonymous" : "",
    thread.isLocked ? "locked" : ""
  ].filter(Boolean);
}

// src/mcp/widgets.ts
var DAY_MS = 864e5;
var EXCERPT_LENGTH = 180;
var PAGE_SIZE = 100;
var THREAD_PAGE_CAP2 = 10;
async function buildForumCatchup(client, courseReference, days) {
  const course = await resolveCourse(client, courseReference);
  const since = Date.now() - days * DAY_MS;
  const inWindow = (await fetchThreadsSince(client, course.id, since)).filter((thread) => Date.parse(thread.createdAt) >= since);
  const announcements = inWindow.filter(isAnnouncement).map((thread) => ({
    createdAt: thread.createdAt,
    id: thread.id,
    number: thread.number,
    seen: thread.isSeen,
    title: thread.title
  }));
  const threads = inWindow.filter((thread) => !isAnnouncement(thread)).map((thread) => ({
    answered: thread.isAnswered,
    category: thread.category,
    createdAt: thread.createdAt,
    excerpt: excerpt(thread.document),
    id: thread.id,
    newReplies: thread.metrics.newReplyCount,
    number: thread.number,
    replies: thread.metrics.replyCount,
    seen: thread.isSeen,
    sub: thread.subcategory,
    title: thread.title,
    type: thread.type
  }));
  const label = courseLabel(course);
  const unreadAnnouncements = announcements.filter((item) => !item.seen);
  const fresh = threads.filter((thread) => !thread.seen || thread.newReplies > 0);
  const lines = [
    `${label}: ${fresh.length} of ${threads.length} threads from the last ${days} days are new or have new replies; ${unreadAnnouncements.length} unread announcements.`,
    ...unreadAnnouncements.map((item) => `- announcement #${item.number} ${item.title}`),
    ...fresh.map(
      (thread) => `- #${thread.number} ${thread.title} (${thread.seen ? `+${thread.newReplies} replies` : "new"}${thread.type === "question" && !thread.answered ? ", unanswered" : ""})`
    )
  ];
  return {
    view: { announcements, course: label, courseId: course.id, days, kind: "forum_catchup", threads },
    text: lines.join("\n")
  };
}
async function buildThreadActivity(client, courseReference, weeks) {
  const course = await resolveCourse(client, courseReference);
  const since = Date.now() - weeks * 7 * DAY_MS;
  const rows = (await fetchThreadsSince(client, course.id, since)).filter((thread) => Date.parse(thread.createdAt) >= since && !isAnnouncement(thread) && !thread.isPinned).map((thread) => ({
    category: thread.category,
    createdAt: thread.createdAt,
    number: thread.number,
    replies: thread.metrics.replyCount,
    sub: thread.subcategory,
    title: thread.title
  }));
  const label = courseLabel(course);
  const byWeek = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const week = utcMonday(row.createdAt);
    const counts = byWeek.get(week) ?? /* @__PURE__ */ new Map();
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    byWeek.set(week, counts);
  }
  const lines = [
    `${label}: ${rows.length} threads in the last ${weeks} weeks, announcements and pinned threads excluded.`,
    ...[...byWeek.entries()].sort(([left], [right]) => left.localeCompare(right)).map(
      ([week, counts]) => `- week of ${week}: ` + [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name || "Uncategorised"} ${count}`).join(", ")
    )
  ];
  return {
    view: { course: label, courseId: course.id, kind: "thread_activity", threads: rows, weeks },
    text: lines.join("\n")
  };
}
async function buildLessonProgress(client, courseReference) {
  const course = await resolveCourse(client, courseReference);
  const { lessons, modules } = await client.fetchLessons(course.id);
  const now = Date.now();
  const rows = modules.map((module) => {
    const inModule = lessons.filter((lesson) => lesson.moduleId === module.id && !lesson.isHidden);
    return {
      completed: inModule.filter(isCompleted).length,
      name: module.name,
      // Ed lessons have no due dates; a module counts as released once its first lesson opens.
      openedAt: earliestOpening(inModule, now),
      total: inModule.length,
      unfinished: inModule.filter((lesson) => !isCompleted(lesson)).map((lesson) => ({ id: lesson.id, status: lesson.status, title: lesson.title }))
    };
  }).filter((row) => row.total > 0);
  const released = rows.filter((row) => row.openedAt).sort((left, right) => String(left.openedAt).localeCompare(String(right.openedAt)));
  const ordered = [...released, ...rows.filter((row) => !row.openedAt)];
  const label = courseLabel(course);
  const behind = released.slice(0, -1).reduce((sum, row) => sum + row.total - row.completed, 0);
  const text = ordered.length === 0 ? `${label} has no Ed lessons; its material is probably in another system.` : [
    `${label}: ${behind} unfinished lessons in released modules before the latest one. ${rows.length - released.length} modules are not released yet.`,
    ...released.map(
      (row) => `- ${row.name}: ${row.completed}/${row.total} completed` + (row.unfinished.length ? `; left: ${row.unfinished.map((lesson) => lesson.title).join("; ")}` : "")
    )
  ].join("\n");
  return {
    view: { course: label, courseId: course.id, kind: "lesson_progress", modules: ordered },
    text
  };
}
async function buildLessonGuide(client, input) {
  for (const [index, item] of input.quiz.entries()) {
    if (item.answer >= item.options.length) {
      throw new EdInputError(`quiz[${index}].answer must index one of its ${item.options.length} options.`);
    }
    if (item.section >= input.sections.length) {
      throw new EdInputError(`quiz[${index}].section must index one of the ${input.sections.length} sections.`);
    }
  }
  const lesson = await client.fetchLesson(input.lessonId);
  const edQuizSlides = lesson.slides.filter((slide) => slide.type.toLowerCase() === "quiz").length;
  return {
    view: {
      edQuizSlides,
      kind: "lesson_guide",
      lesson: { id: lesson.id, module: lesson.moduleName, title: lesson.title },
      quiz: input.quiz,
      sections: input.sections
    },
    text: `Showing a ${input.sections.length}-section guide to "${lesson.title}" with ${input.quiz.length} practice questions. The student steps through it and answers in the widget; wait for them to ask before explaining further.`
  };
}
async function fetchThreadsSince(client, courseId, since) {
  const threads = [];
  for (let page = 0; page < THREAD_PAGE_CAP2; page += 1) {
    const batch = await client.fetchThreads(courseId, { limit: PAGE_SIZE, offset: page * PAGE_SIZE, sort: "new" });
    threads.push(...batch);
    const oldest = batch.filter((thread) => !thread.isPinned).at(-1);
    if (batch.length < PAGE_SIZE || oldest && Date.parse(oldest.createdAt) < since) {
      break;
    }
  }
  return threads;
}
function isAnnouncement(thread) {
  return thread.type.toLowerCase() === "announcement";
}
function isCompleted(lesson) {
  return lesson.status.toLowerCase() === "completed";
}
function earliestOpening(lessons, now) {
  const opened = lessons.map((lesson) => Date.parse(lesson.availableAt)).filter((time) => Number.isFinite(time) && time <= now);
  return opened.length ? new Date(Math.min(...opened)).toISOString() : null;
}
function excerpt(document) {
  const text = document.replace(/\s+/g, " ").trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1).trimEnd()}\u2026` : text;
}
function courseLabel(course) {
  return course.code.trim().split(/\s+/u)[0] || course.name || String(course.id);
}
function utcMonday(iso) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
export {
  EdClient,
  buildForumCatchup,
  buildLessonGuide,
  buildLessonProgress,
  buildThreadActivity,
  lessonToMarkdown,
  listLessonFiles,
  listLessons,
  listThreadFiles,
  listThreads,
  parseSinceValue,
  projectThreadDetail,
  slideToMarkdown,
  threadToMarkdown
};
