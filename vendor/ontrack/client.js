// src/errors.ts
var CliError = class extends Error {
  category;
  statusCode;
  hint;
  constructor(category, message, statusCode, hint) {
    super(message);
    this.name = "CliError";
    this.category = category;
    this.statusCode = statusCode;
    this.hint = hint;
  }
};

// src/grades.ts
var fallback = /* @__PURE__ */ new Map([
  [-1, { id: "legacy-f", value: -1, name: "Fail", abbreviation: "F" }],
  [0, { id: "legacy-p", value: 0, name: "Pass", abbreviation: "P" }],
  [1, { id: "legacy-c", value: 1, name: "Credit", abbreviation: "C" }],
  [2, { id: "legacy-d", value: 2, name: "Distinction", abbreviation: "D" }],
  [3, { id: "legacy-hd", value: 3, name: "High Distinction", abbreviation: "HD" }]
]);
function readGradeDefinitions(value) {
  if (value === void 0 || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError("grade_definitions must be an array");
  if (value.length === 0) throw new TypeError("grade_definitions must not be empty when present");
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new TypeError("grade definition must be an object");
    const data = item;
    if (typeof data.id !== "string" || typeof data.value !== "number") throw new TypeError("Grade id must be a string and value must be a number");
    const name = data.name ?? data.label ?? fallback.get(data.value)?.name;
    if (typeof name !== "string" || typeof data.abbreviation !== "string") throw new TypeError("Grade name and abbreviation must be strings");
    return { id: data.id, value: data.value, name, abbreviation: data.abbreviation };
  });
}
function gradeLabel(value, definitions) {
  if (value === null) return "-";
  const match = definitions.find((definition) => definition.value === value) ?? (definitions.length === 0 ? fallback.get(value) : void 0);
  return match ? `${match.abbreviation} (${match.name})` : String(value);
}

// src/time.ts
var CivilDate = class _CivilDate {
  #value;
  #ordinal;
  constructor(value, ordinal) {
    this.#value = value;
    this.#ordinal = ordinal;
  }
  static parse(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError(`Invalid civil date: ${value}`);
    const [year, month, day] = value.split("-").map(Number);
    const date = /* @__PURE__ */ new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year ?? 0, (month ?? 0) - 1, day);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
      throw new TypeError(`Invalid civil date: ${value}`);
    }
    return new _CivilDate(value, date.valueOf());
  }
  compare(other) {
    return this.#ordinal < other.#ordinal ? -1 : this.#ordinal > other.#ordinal ? 1 : 0;
  }
  addDays(days) {
    const [year, month, day] = this.#value.split("-").map(Number);
    const value = /* @__PURE__ */ new Date(0);
    value.setUTCHours(0, 0, 0, 0);
    value.setUTCFullYear(year ?? 0, (month ?? 0) - 1, day);
    value.setUTCDate(value.getUTCDate() + days);
    return _CivilDate.parse(value.toISOString().slice(0, 10));
  }
  toString() {
    return this.#value;
  }
};
var Instant = class _Instant {
  #value;
  constructor(value) {
    this.#value = value;
  }
  static parse(value) {
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new TypeError(`Invalid instant: ${value}`);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.valueOf())) throw new TypeError(`Invalid instant: ${value}`);
    return new _Instant(parsed);
  }
  compare(other) {
    const left = this.#value.valueOf();
    const right = other.#value.valueOf();
    return left < right ? -1 : left > right ? 1 : 0;
  }
  toString() {
    return this.#value.toISOString();
  }
};

// src/readers.ts
function contract(message) {
  throw new CliError("upstream_contract", message);
}
function object(value, name) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return contract(`${name} must be an object`);
  return value;
}
function array(value, name) {
  if (!Array.isArray(value)) return contract(`${name} must be an array`);
  return value;
}
function requiredNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) return contract(`${name} must be a number`);
  return value;
}
function requiredPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) return contract(`${name} must be a positive safe integer`);
  return value;
}
function requiredString(value, name) {
  if (typeof value !== "string") return contract(`${name} must be a string`);
  return value;
}
function requiredBoolean(value, name) {
  if (typeof value !== "boolean") return contract(`${name} must be a boolean`);
  return value;
}
function nullableNumber(value, name) {
  if (value === void 0 || value === null) return null;
  return requiredNumber(value, name);
}
function nonnegativeInteger(value, name) {
  if (value === void 0 || value === null) return 0;
  if (!Number.isSafeInteger(value) || value < 0) return contract(`${name} must be a non-negative safe integer`);
  return value;
}
function nullableString(value, name) {
  if (value === void 0 || value === null) return null;
  return requiredString(value, name);
}
function nullableBoolean(value, name) {
  if (value === void 0 || value === null) return null;
  if (typeof value !== "boolean") return contract(`${name} must be a boolean`);
  return value;
}
function civilDate(value, name) {
  const text2 = nullableString(value, name);
  if (text2 === null) return null;
  try {
    return CivilDate.parse(text2);
  } catch {
    return contract(`${name} must be a civil date`);
  }
}
function instant(value, name) {
  const text2 = nullableString(value, name);
  if (text2 === null) return null;
  try {
    return Instant.parse(text2);
  } catch {
    return contract(`${name} must be an instant`);
  }
}
function readUnitSummary(value) {
  const data = object(value, "unit");
  return {
    id: requiredPositiveInteger(data.id, "unit id"),
    code: requiredString(data.code, "unit code"),
    name: requiredString(data.name, "unit name"),
    my_role: nullableString(data.my_role, "unit my_role"),
    start_date: civilDate(data.start_date, "unit start_date"),
    end_date: civilDate(data.end_date, "unit end_date"),
    active: nullableBoolean(data.active, "unit active"),
    allow_flexible_dates: nullableBoolean(data.allow_flexible_dates, "unit allow_flexible_dates")
  };
}
function readTask(value) {
  const data = object(value, "task");
  return {
    id: requiredPositiveInteger(data.id, "task id"),
    task_definition_id: requiredPositiveInteger(data.task_definition_id, "task task_definition_id"),
    status: requiredString(data.status, "task status"),
    due_date: civilDate(data.due_date, "task due_date"),
    target_due_date: civilDate(data.target_due_date, "task target_due_date"),
    target_start_date: civilDate(data.target_start_date, "task target_start_date"),
    submission_date: civilDate(data.submission_date, "task submission_date"),
    completion_date: civilDate(data.completion_date, "task completion_date"),
    moved_to_discuss_at: instant(data.moved_to_discuss_at, "task moved_to_discuss_at"),
    discuss_timeout_expiry_at: instant(data.discuss_timeout_expiry_at, "task discuss_timeout_expiry_at"),
    extensions: nullableNumber(data.extensions, "task extensions"),
    times_assessed: nullableNumber(data.times_assessed, "task times_assessed"),
    grade: nullableNumber(data.grade, "task grade"),
    quality_pts: nullableNumber(data.quality_pts, "task quality_pts"),
    include_in_portfolio: nullableBoolean(data.include_in_portfolio, "task include_in_portfolio"),
    num_new_comments: nonnegativeInteger(data.num_new_comments, "task num_new_comments")
  };
}
function readTaskUpdate(value) {
  const data = object(value, "task update");
  return {
    id: requiredPositiveInteger(data.id, "task update id"),
    task_definition_id: requiredPositiveInteger(data.task_definition_id, "task update task_definition_id"),
    status: requiredString(data.status, "task update status")
  };
}
function readTaskDefinition(value) {
  const data = object(value, "task definition");
  const gradeDueDates = {};
  const gradeStartDates = {};
  for (const entry of data.grade_due_dates === void 0 ? [] : array(data.grade_due_dates, "grade_due_dates")) {
    const override = object(entry, "grade due date");
    const grade = requiredNumber(override.target_grade, "grade due date target_grade");
    const due = civilDate(override.target_due_date, "grade due date target_due_date");
    const start = civilDate(override.start_date, "grade due date start_date");
    if (due) gradeDueDates[String(grade)] = due;
    if (start) gradeStartDates[String(grade)] = start;
  }
  return {
    id: requiredPositiveInteger(data.id, "task definition id"),
    abbreviation: requiredString(data.abbreviation, "task definition abbreviation"),
    name: requiredString(data.name, "task definition name"),
    description: nullableString(data.description, "task definition description"),
    target_grade: nullableNumber(data.target_grade, "task definition target_grade"),
    start_date: civilDate(data.start_date, "task definition start_date"),
    target_date: civilDate(data.target_date, "task definition target_date"),
    due_date: civilDate(data.due_date, "task definition due_date"),
    is_graded: nullableBoolean(data.is_graded, "task definition is_graded"),
    max_quality_pts: nullableNumber(data.max_quality_pts, "task definition max_quality_pts"),
    has_task_sheet: nullableBoolean(data.has_task_sheet, "task definition has_task_sheet"),
    has_task_resources: nullableBoolean(data.has_task_resources, "task definition has_task_resources"),
    upload_requirements: readUploadRequirements(data.upload_requirements),
    grade_due_dates: gradeDueDates,
    grade_start_dates: gradeStartDates
  };
}
function readUploadRequirements(value) {
  if (value === void 0 || value === null) return [];
  return array(value, "task definition upload_requirements").map((item, index) => {
    const data = object(item, `upload requirement ${index + 1}`);
    const key = requiredString(data.key, `upload requirement key ${index + 1}`);
    if (key !== `file${index}`) return contract(`upload requirement key ${index + 1} must be file${index}`);
    const type = requiredString(data.type, `upload requirement type ${index + 1}`);
    if (type !== "code" && type !== "document" && type !== "image" && type !== "zip") {
      return contract(`upload requirement type ${index + 1} is unsupported`);
    }
    return {
      key,
      name: requiredString(data.name, `upload requirement name ${index + 1}`),
      type,
      submission_history: nullableBoolean(data.submission_history, `upload requirement submission_history ${index + 1}`) ?? false
    };
  });
}
function readProjects(value) {
  return array(value, "projects").map((item) => {
    const data = object(item, "project summary");
    return {
      id: requiredPositiveInteger(data.id, "project id"),
      unit: readUnitSummary(data.unit),
      target_grade: nullableNumber(data.target_grade, "project target_grade"),
      portfolio_available: nullableBoolean(data.portfolio_available, "project portfolio_available"),
      user_id: nullableNumber(data.user_id, "project user_id"),
      unit_id: nullableNumber(data.unit_id, "project unit_id")
    };
  });
}
function readProject(value) {
  const data = object(value, "project");
  const unit = readUnitSummary(data.unit);
  return {
    id: requiredPositiveInteger(data.id, "project id"),
    unit,
    target_grade: nullableNumber(data.target_grade, "project target_grade"),
    submitted_grade: nullableNumber(data.submitted_grade, "project submitted_grade"),
    compile_portfolio: nullableBoolean(data.compile_portfolio, "project compile_portfolio"),
    portfolio_available: nullableBoolean(data.portfolio_available, "project portfolio_available"),
    uses_draft_learning_summary: nullableBoolean(data.uses_draft_learning_summary, "project uses_draft_learning_summary"),
    flexible_dates: unit.allow_flexible_dates ?? false,
    special_consideration_days: nullableNumber(data.spec_con_days, "project spec_con_days") ?? 0,
    tasks: array(data.tasks, "project tasks").map(readTask)
  };
}
function readUnit(value) {
  const data = object(value, "unit");
  const summary = readUnitSummary(data);
  let definitions;
  try {
    definitions = readGradeDefinitions(data.grade_definitions);
  } catch (error) {
    return contract(error instanceof Error ? error.message : "Invalid grade_definitions");
  }
  return {
    ...summary,
    description: nullableString(data.description, "unit description"),
    grade_definitions: definitions,
    task_definitions: array(data.task_definitions, "unit task_definitions").map(readTaskDefinition)
  };
}
function readUser(value) {
  const data = object(value, "user");
  return {
    id: nullableNumber(data.id, "user id"),
    username: nullableString(data.username, "user username"),
    first_name: nullableString(data.first_name ?? data.firstName, "user first_name"),
    last_name: nullableString(data.last_name ?? data.lastName, "user last_name"),
    email: nullableString(data.email, "user email"),
    nickname: nullableString(data.nickname, "user nickname")
  };
}
function readRoles(value) {
  return array(value, "roles").map((item) => {
    const data = object(item, "role");
    return {
      id: requiredPositiveInteger(data.id, "role id"),
      role: requiredString(data.role, "role role"),
      unit: readUnitSummary(data.unit),
      user: data.user === void 0 || data.user === null ? null : readUser(data.user)
    };
  });
}
function readTaskCommentParty(value, name) {
  const data = object(value, name);
  return {
    id: requiredPositiveInteger(data.id, `${name} id`),
    first_name: requiredString(data.first_name, `${name} first_name`),
    last_name: requiredString(data.last_name, `${name} last_name`),
    email: requiredString(data.email, `${name} email`)
  };
}
function readTaskComment(value) {
  const data = object(value, "task comment");
  const createdAt = instant(data.created_at, "task comment created_at");
  if (!createdAt) return contract("task comment created_at must be an instant");
  const recipientReadTime = instant(data.recipient_read_time, "task comment recipient_read_time");
  const status = data.status === void 0 ? void 0 : requiredString(data.status, "task comment status");
  return {
    id: requiredPositiveInteger(data.id, "task comment id"),
    comment: requiredString(data.comment, "task comment comment"),
    has_attachment: requiredBoolean(data.has_attachment, "task comment has_attachment"),
    type: requiredString(data.type, "task comment type"),
    is_new: requiredBoolean(data.is_new, "task comment is_new"),
    reply_to_id: data.reply_to_id === null ? null : requiredPositiveInteger(data.reply_to_id, "task comment reply_to_id"),
    author: readTaskCommentParty(data.author, "task comment author"),
    recipient: readTaskCommentParty(data.recipient, "task comment recipient"),
    created_at: createdAt.toString(),
    recipient_read_time: recipientReadTime?.toString() ?? null,
    ...status === void 0 ? {} : { status }
  };
}
function readTaskComments(value) {
  return array(value, "task comments").map(readTaskComment);
}

// src/ontrack.ts
function isZip(bytes) {
  if (bytes.length < 22) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstPossibleOffset = Math.max(0, bytes.length - 22 - 65535);
  for (let offset = bytes.length - 22; offset >= firstPossibleOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== 101010256) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength !== bytes.length) continue;
    const disk = view.getUint16(offset + 4, true);
    const centralDisk = view.getUint16(offset + 6, true);
    const diskEntries = view.getUint16(offset + 8, true);
    const entries = view.getUint16(offset + 10, true);
    const centralSize = view.getUint32(offset + 12, true);
    const centralOffset = view.getUint32(offset + 16, true);
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== entries || centralOffset + centralSize !== offset) return false;
    if (entries === 0) return centralSize === 0;
    let cursor = centralOffset;
    for (let entry = 0; entry < entries; entry += 1) {
      if (cursor + 46 > offset || view.getUint32(cursor, true) !== 33639248) return false;
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const entryCommentLength = view.getUint16(cursor + 32, true);
      const localOffset = view.getUint32(cursor + 42, true);
      if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 67324752) return false;
      cursor += 46 + nameLength + extraLength + entryCommentLength;
    }
    return cursor === offset;
  }
  return false;
}
var OnTrackClient = class {
  constructor(http) {
    this.http = http;
  }
  http;
  // Resolving a unit reads the list, and so does the command that follows; one
  // process is short enough that reading it twice is only a wasted round trip.
  projectsByScope = /* @__PURE__ */ new Map();
  async getProjects(includeInactive = false) {
    let pending = this.projectsByScope.get(includeInactive);
    if (!pending) {
      pending = this.http.request("api/projects", { query: { include_inactive: includeInactive } }).then(readProjects);
      this.projectsByScope.set(includeInactive, pending);
    }
    return pending;
  }
  async getProject(id) {
    try {
      return readProject(await this.http.request(`api/projects/${id}`));
    } catch (error) {
      if (error instanceof CliError && error.statusCode === 403) {
        throw new CliError(
          "upstream_api",
          `Project ${id} is not accessible. Project arguments use the id from \`ontrack projects --include-inactive\`, not list positions.`,
          403
        );
      }
      throw error;
    }
  }
  async getUnit(id) {
    return readUnit(await this.http.request(`api/units/${id}`));
  }
  async downloadProjectResources(projectId) {
    const project = await this.getProject(projectId);
    let bytes;
    try {
      bytes = await this.http.download(`api/units/${project.unit.id}/all_resources`);
    } catch (error) {
      if (error instanceof CliError && error.statusCode === 401) {
        throw new CliError("upstream_api", `Resources for project ${projectId} are not accessible`, 401);
      }
      throw error;
    }
    if (!isZip(bytes)) {
      throw new CliError("upstream_contract", "OnTrack returned an invalid resource archive");
    }
    return { projectId, unitId: project.unit.id, bytes };
  }
  async downloadTaskSheet(unitId, taskDefinitionId) {
    return this.http.downloadFile(`api/units/${unitId}/task_definitions/${taskDefinitionId}/task_pdf`, {
      query: { as_attachment: true }
    });
  }
  async downloadTaskResources(unitId, taskDefinitionId) {
    return this.http.downloadFile(`api/units/${unitId}/task_definitions/${taskDefinitionId}/task_resources`);
  }
  async getTaskComments(projectId, taskDefinitionId) {
    return readTaskComments(await this.http.request(
      `api/projects/${projectId}/task_def_id/${taskDefinitionId}/comments`
    ));
  }
  async updateTaskState(projectId, taskDefinitionId, state) {
    return readTaskUpdate(await this.http.request(
      `api/projects/${projectId}/task_def_id/${taskDefinitionId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: state })
      }
    ));
  }
  async addTaskComment(projectId, taskDefinitionId, message) {
    try {
      return readTaskComment(await this.http.request(
        `api/projects/${projectId}/task_def_id/${taskDefinitionId}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ comment: message })
        }
      ));
    } catch (error) {
      if (error instanceof CliError && error.category === "upstream_api") {
        throw new CliError(
          "upstream_api",
          `Chat message was rejected by OnTrack${error.statusCode ? ` (HTTP ${error.statusCode})` : ""}`,
          error.statusCode
        );
      }
      throw error;
    }
  }
  async submitTask(projectId, taskDefinitionId, uploads, options) {
    const form = new FormData();
    for (const upload of uploads) {
      form.append(upload.key, new Blob([upload.bytes.slice()], { type: upload.contentType }), upload.filename);
    }
    form.append("trigger", options.type);
    if (options.comment !== void 0) form.append("comment", options.comment);
    if (options.acceptTiiEula) form.append("accepted_tii_eula", "true");
    const response = await this.http.requestWithStatus(
      `api/projects/${projectId}/task_def_id/${taskDefinitionId}/submission`,
      { method: "POST", body: form }
    );
    if (response.status !== 201) {
      throw new CliError("upstream_contract", `OnTrack submission returned HTTP ${response.status}; expected HTTP 201`);
    }
    return readTaskUpdate(response.value);
  }
  async getRoles(activeOnly = true) {
    return readRoles(await this.http.request("api/unit_roles", {
      query: { active_only: activeOnly }
    }));
  }
  async getAuthMethod() {
    const value = await this.http.request("api/auth/method");
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new CliError("upstream_contract", "auth method must be an object");
    }
    const method = Reflect.get(value, "method");
    const redirectTo = Reflect.get(value, "redirect_to");
    if (typeof method !== "string" || redirectTo !== void 0 && redirectTo !== null && typeof redirectTo !== "string") {
      throw new CliError("upstream_contract", "auth method response is invalid");
    }
    return redirectTo === void 0 ? { method } : { method, redirect_to: redirectTo };
  }
};

// src/http.ts
var maxDownloadBytes = 256 * 1024 * 1024;
var maxErrorResponseBytes = 64 * 1024;
function archiveTooLarge() {
  return new CliError("upstream_api", "OnTrack download exceeds the 256 MiB limit");
}
function contentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(value ?? "");
  if (!match) return void 0;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end) return void 0;
  return { start, end, total };
}
function requireContentRange(response, expectedStart, expectedTotal) {
  const range = contentRange(response.headers.get("Content-Range"));
  if (response.status !== 206 || !range || range.start !== expectedStart || expectedTotal !== void 0 && range.total !== expectedTotal || response.bytes.length !== range.end - range.start + 1) {
    throw new CliError("upstream_contract", "OnTrack returned an invalid Content-Range response");
  }
  return range;
}
function responseFilename(value) {
  if (!value) return null;
  const extended = /(?:^|;)\s*filename\*=UTF-8''([^;]+)/iu.exec(value)?.[1];
  let filename;
  if (extended) {
    try {
      filename = decodeURIComponent(extended.trim());
    } catch {
      filename = void 0;
    }
  }
  filename ??= /(?:^|;)\s*filename="([^"]*)"/iu.exec(value)?.[1] ?? /(?:^|;)\s*filename=([^;]+)/iu.exec(value)?.[1]?.trim();
  if (!filename) return null;
  const safe = filename.replaceAll("\\", "/").split("/").at(-1)?.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return safe && safe !== "." && safe !== ".." ? safe : null;
}
async function responseBytes(response, limit) {
  if (limit === void 0) return new Uint8Array(await response.arrayBuffer());
  const range = contentRange(response.headers.get("Content-Range"));
  if (range && range.total > limit) {
    await response.body?.cancel().catch(() => void 0);
    throw archiveTooLarge();
  }
  const lengthHeader = response.headers.get("Content-Length");
  const contentLength = lengthHeader && /^\d+$/u.test(lengthHeader) ? Number(lengthHeader) : void 0;
  if (contentLength !== void 0 && contentLength > limit) {
    await response.body?.cancel().catch(() => void 0);
    throw archiveTooLarge();
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  let bytes = new Uint8Array(Math.min(64 * 1024, limit));
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const nextTotal = total + value.length;
    if (nextTotal > limit) {
      await reader.cancel();
      throw archiveTooLarge();
    }
    if (nextTotal > bytes.length) {
      const capacity = Math.min(limit, Math.max(nextTotal, bytes.length * 2));
      const grown = new Uint8Array(capacity);
      grown.set(bytes.subarray(0, total));
      bytes = grown;
    }
    bytes.set(value, total);
    total = nextTotal;
  }
  return bytes.subarray(0, total);
}
async function errorResponseBytes(response) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const bytes = new Uint8Array(maxErrorResponseBytes);
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return bytes.subarray(0, total);
    if (total + value.length > bytes.length) {
      await reader.cancel();
      return new Uint8Array();
    }
    bytes.set(value, total);
    total += value.length;
  }
}
function upstreamErrorDetail(bytes) {
  if (bytes.length === 0) return void 0;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
    const error = Reflect.get(value, "error");
    if (typeof error !== "string") return void 0;
    const safe = error.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
    return safe ? Array.from(safe).slice(0, 500).join("") : void 0;
  } catch {
    return void 0;
  }
}
var HttpClient = class {
  #baseUrl;
  #fetch;
  #refresh;
  #timeoutMs;
  #signal;
  #trace;
  #credentials;
  #refreshing;
  #sessionVersion = 0;
  constructor(options) {
    this.#baseUrl = new URL(options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`);
    this.#credentials = options.credentials;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#refresh = options.refresh;
    this.#timeoutMs = options.timeoutMs ?? 3e4;
    this.#signal = options.signal;
    this.#trace = options.trace;
  }
  async request(path, options = {}) {
    return (await this.requestWithStatus(path, options)).value;
  }
  async requestWithStatus(path, options = {}) {
    const response = await this.#response(path, options);
    try {
      return { status: response.status, value: JSON.parse(new TextDecoder().decode(response.bytes)) };
    } catch {
      throw new CliError("upstream_contract", "OnTrack returned invalid JSON");
    }
  }
  async download(path, options = {}) {
    return (await this.downloadFile(path, options)).bytes;
  }
  async downloadFile(path, options = {}) {
    const headers = new Headers(options.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/octet-stream");
    const first = await this.#response(path, { ...options, headers }, maxDownloadBytes);
    const metadata2 = {
      contentType: first.headers.get("Content-Type")?.split(";", 1)[0]?.trim() || null,
      filename: responseFilename(first.headers.get("Content-Disposition"))
    };
    if (first.status !== 206) return { bytes: first.bytes, ...metadata2 };
    const initialRange = requireContentRange(first, 0);
    if (initialRange.total > maxDownloadBytes) throw archiveTooLarge();
    const bytes = new Uint8Array(initialRange.total);
    bytes.set(first.bytes, 0);
    let offset = initialRange.end + 1;
    while (offset < initialRange.total) {
      const rangeHeaders = new Headers(headers);
      rangeHeaders.set("Range", `bytes=${offset}-`);
      const response = await this.#response(path, { ...options, headers: rangeHeaders }, maxDownloadBytes);
      const range = requireContentRange(response, offset, initialRange.total);
      bytes.set(response.bytes, offset);
      offset = range.end + 1;
    }
    return { bytes, ...metadata2 };
  }
  async #response(path, options, responseLimit) {
    const url = new URL(path.replace(/^\//, ""), this.#baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== void 0 && value !== null) url.searchParams.set(key, String(value));
    }
    const method = (options.method ?? "GET").toUpperCase();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sessionVersion = this.#sessionVersion;
      const startedAt = Date.now();
      const response = await this.#send(url, method, options, responseLimit);
      this.#trace?.({ method, url: url.toString(), status: response.status, ms: Date.now() - startedAt });
      if (response.status === 419 && method === "GET" && attempt === 0 && this.#refresh) {
        if (sessionVersion === this.#sessionVersion) {
          await this.#refreshOnce(options.signal ?? this.#signal ?? new AbortController().signal);
        }
        continue;
      }
      if (response.status === 401 || response.status === 419) {
        throw new CliError("auth", "OnTrack rejected the authenticated session", response.status);
      }
      if (response.status === 404) {
        throw new CliError("not_found", "The requested OnTrack entity does not exist", response.status);
      }
      if (!response.ok) {
        const detail = upstreamErrorDetail(response.bytes);
        throw new CliError("upstream_api", `OnTrack returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`, response.status);
      }
      return response;
    }
    throw new CliError("auth", "OnTrack rejected the refreshed session", 419);
  }
  async #refreshOnce(signal) {
    this.#refreshing ??= (async () => {
      const refreshed = await this.#refresh?.(signal);
      if (refreshed) this.#credentials = refreshed;
      this.#sessionVersion += 1;
    })().finally(() => {
      this.#refreshing = void 0;
    });
    await this.#refreshing;
  }
  async #send(url, method, options, responseLimit) {
    const headers = new Headers(options.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    headers.set("Username", this.#credentials.username);
    headers.set("Auth-Token", this.#credentials.accessToken);
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.#timeoutMs);
    const externalSignal = options.signal ?? this.#signal;
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeoutController.signal]) : timeoutController.signal;
    try {
      const init = { method, headers, signal };
      if (options.body !== void 0) init.body = options.body;
      const response = await this.#fetch(url, init);
      if (!response.ok) {
        return { status: response.status, ok: false, bytes: await errorResponseBytes(response), headers: new Headers(response.headers) };
      }
      return {
        status: response.status,
        ok: response.ok,
        bytes: await responseBytes(response, responseLimit),
        headers: new Headers(response.headers)
      };
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (externalSignal?.aborted) {
        throw new CliError("cancellation", "Request cancelled");
      }
      if (timeoutController.signal.aborted) {
        throw new CliError("network", `OnTrack request timed out after ${this.#timeoutMs}ms`);
      }
      throw new CliError("network", error instanceof Error ? error.message : "Network request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
};

// src/status.ts
var statuses = {
  ready_for_feedback: { label: "Ready for Feedback", final: false, submitted: true },
  not_started: { label: "Not Started", final: false, submitted: false },
  working_on_it: { label: "Working On It", final: false, submitted: false },
  need_help: { label: "Need Help", final: false, submitted: false },
  redo: { label: "Redo", final: false, submitted: false },
  feedback_exceeded: { label: "Feedback Exceeded", final: true, submitted: true },
  fix_and_resubmit: { label: "Resubmit", final: false, submitted: false },
  discuss: { label: "Discuss", final: false, submitted: true },
  demonstrate: { label: "Demonstrate", final: false, submitted: true },
  complete: { label: "Complete", final: true, submitted: true },
  fail: { label: "Fail", final: true, submitted: true },
  time_exceeded: { label: "Time Exceeded", final: true, submitted: true },
  assess_in_portfolio: { label: "Assess in Portfolio", final: true, submitted: true },
  attention_required: { label: "Attention Required", final: false, submitted: true },
  rediscuss: { label: "Rediscuss", final: false, submitted: true }
};
function metadata(key) {
  return statuses[key];
}
function statusLabel(key) {
  return metadata(key)?.label ?? key;
}
function isFinalStatus(key) {
  return metadata(key)?.final ?? false;
}
var STATUS_TONES = {
  "Ready for Feedback": "success",
  "Not Started": "muted",
  "Working On It": "warning",
  "Need Help": "danger",
  "Redo": "danger",
  "Feedback Exceeded": "danger",
  "Resubmit": "danger",
  "Discuss": "warning",
  "Demonstrate": "warning",
  "Complete": "success",
  "Fail": "danger",
  "Time Exceeded": "danger",
  "Assess in Portfolio": "info",
  "Attention Required": "danger",
  "Rediscuss": "warning",
  ...Object.fromEntries(Object.entries({
    ready_for_feedback: "success",
    not_started: "muted",
    working_on_it: "warning",
    need_help: "danger",
    redo: "danger",
    feedback_exceeded: "danger",
    fix_and_resubmit: "danger",
    discuss: "warning",
    demonstrate: "warning",
    complete: "success",
    fail: "danger",
    time_exceeded: "danger",
    assess_in_portfolio: "info",
    attention_required: "danger",
    rediscuss: "warning"
  }))
};

// src/project-snapshot.ts
function effectiveDue(project, task, definition) {
  if (project.flexible_dates) {
    if (task.target_due_date) return task.target_due_date;
    const gradeDate = definition?.grade_due_dates[String(project.target_grade)];
    if (gradeDate) return gradeDate;
  }
  return task.due_date ?? definition?.target_date ?? null;
}
function effectiveStart(project, task, definition) {
  if (project.flexible_dates) {
    if (task.target_start_date) return task.target_start_date;
    const gradeStart = definition?.grade_start_dates[String(project.target_grade)];
    if (gradeStart) return gradeStart;
  }
  const base = definition?.start_date ?? null;
  if (base && task.extensions !== null && task.extensions < 0) {
    return base.addDays(task.extensions * 7);
  }
  return base;
}
function text(value) {
  return value?.toString() ?? null;
}
function buildProjectSnapshot(project, unit, clock) {
  const definitions = new Map(unit.task_definitions.map((definition) => [definition.id, definition]));
  const scheduled = project.tasks.map((task) => {
    const definition = definitions.get(task.task_definition_id);
    const due = effectiveDue(project, task, definition);
    const start = effectiveStart(project, task, definition);
    const deadline = due?.addDays(project.special_consideration_days) ?? null;
    return { due, row: {
      id: task.id,
      task_definition_id: task.task_definition_id,
      abbreviation: definition?.abbreviation ?? `TD-${task.task_definition_id}`,
      name: definition?.name ?? "Unknown task",
      status: task.status,
      status_label: statusLabel(task.status),
      target_grade: definition?.target_grade ?? null,
      target_grade_label: gradeLabel(definition?.target_grade ?? null, unit.grade_definitions),
      start_date: text(start),
      target_date: text(definition?.target_date),
      target_start_date: text(task.target_start_date),
      target_due_date: text(task.target_due_date),
      due_date: text(due),
      deadline: text(deadline),
      submission_date: text(task.submission_date),
      completion_date: text(task.completion_date),
      moved_to_discuss_at: text(task.moved_to_discuss_at),
      discuss_timeout_expiry_at: text(task.discuss_timeout_expiry_at),
      extensions: task.extensions,
      grade: task.grade,
      grade_label: gradeLabel(task.grade, unit.grade_definitions),
      quality_pts: task.quality_pts,
      include_in_portfolio: task.include_in_portfolio,
      is_overdue: Boolean(deadline && deadline.compare(clock.today) < 0 && !isFinalStatus(task.status)),
      is_discuss_overdue: Boolean(task.discuss_timeout_expiry_at && task.discuss_timeout_expiry_at.compare(clock.now) < 0)
    } };
  });
  scheduled.sort((left, right) => {
    const dueOrder = left.due === null ? right.due === null ? 0 : 1 : right.due === null ? -1 : left.due.compare(right.due);
    if (dueOrder !== 0) return dueOrder;
    const abbreviationOrder = left.row.abbreviation < right.row.abbreviation ? -1 : left.row.abbreviation > right.row.abbreviation ? 1 : 0;
    return abbreviationOrder || left.row.id - right.row.id;
  });
  return { project, unit, tasks: scheduled.map(({ row }) => row) };
}
export {
  CivilDate,
  HttpClient,
  Instant,
  OnTrackClient,
  buildProjectSnapshot
};
