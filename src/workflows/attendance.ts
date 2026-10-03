import { assertDate, type Unit } from "../domain/units.ts";
import type {
  Evidence,
  EvidenceSearch,
  SearchCoverage,
} from "../domain/evidence.ts";

export interface AttendanceQuery {
  date: string;
  session_type?: string;
  group?: string;
}
export interface AttendanceCandidate {
  code: string;
  class_date: string | null;
  date_basis: "explicit" | "relative" | "unconfirmed";
  match: "matches_context" | "needs_confirmation";
  evidence: Array<{
    source: string;
    url: string;
    title: string;
    excerpt: string;
    published_at?: string;
  }>;
}

const CODE =
  /(?:attendance\s+(?:verification\s+)?code|check[ -]?in\s+code|签到码|簽到碼|出席码|出席碼)\s*(?:is\b|为|是)?\s*[:：=\-]?\s*[`"']?([A-Za-z0-9][A-Za-z0-9_-]{2,31})\b/giu;
const STOP_WORDS = new Set([
  "the",
  "for",
  "will",
  "has",
  "was",
  "available",
  "posted",
  "provided",
  "here",
  "below",
  "today",
]);
const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

function dates(text: string): string[] {
  const found: string[] = [];
  const add = (value: string) => {
    try {
      found.push(assertDate(value));
    } catch {
      /* Ignore invalid dates in source text. */
    }
  };
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))
    add(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/g))
    add(`${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`);
  for (const m of text.matchAll(
    /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/gi,
  ))
    add(`${m[3]}-${MONTHS[m[2]!.toLowerCase()]}-${m[1]!.padStart(2, "0")}`);
  return [...new Set(found)];
}

function calendarDate(
  timestamp: string | undefined,
  timezone: string,
): string | null {
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function mentioned(
  context: string,
  value: string | undefined,
  group = false,
): boolean {
  if (!value) return true;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = group ? "(?:group|grp|组|組)\\s*[:#-]?\\s*" : "\\b";
  return new RegExp(`${prefix}${escaped}(?![\\w-])`, "i").test(context);
}

export function extractCandidates(
  unit: Unit,
  query: AttendanceQuery,
  evidence: readonly Evidence[],
): AttendanceCandidate[] {
  assertDate(query.date);
  const candidates = new Map<string, AttendanceCandidate>();
  for (const item of evidence) {
    if (item.unit_key !== unit.key) continue;
    // Keep paragraph boundaries: neighbouring class codes must not share dates or groups.
    for (const paragraph of item.text.split(/\n\s*\n/)) {
      for (const match of paragraph.matchAll(CODE)) {
        const code = match[1]!;
        if (
          STOP_WORDS.has(code.toLowerCase()) ||
          (!/\d/.test(code) && code.length > 12)
        )
          continue;
        const start = Math.max(0, match.index! - 180);
        const end = Math.min(
          paragraph.length,
          match.index! + match[0].length + 180,
        );
        const excerpt = paragraph.slice(start, end).trim();
        const localDates = dates(excerpt);
        const contextualDates = localDates.length
          ? localDates
          : dates(item.title);
        let classDate: string | null =
          contextualDates.length === 1 ? contextualDates[0]! : null;
        let basis: AttendanceCandidate["date_basis"] = classDate
          ? "explicit"
          : "unconfirmed";
        if (
          !contextualDates.length &&
          /\b(?:today|tonight)\b|今天|今日/i.test(excerpt)
        ) {
          classDate = calendarDate(item.published_at, unit.timezone);
          if (classDate) basis = "relative";
        }
        // An explicitly dated code for another day is not a candidate for this class.
        if (classDate && classDate !== query.date) continue;
        const context = `${item.title}\n${excerpt}`;
        const matches =
          classDate === query.date &&
          mentioned(context, query.session_type) &&
          mentioned(context, query.group, true);
        const key = `${code}:${classDate ?? "unknown"}:${matches}`;
        const source = {
          source: item.source,
          url: item.url,
          title: item.title,
          excerpt,
          published_at: item.published_at,
        };
        const existing = candidates.get(key);
        if (existing) {
          if (
            !existing.evidence.some(
              (e) => e.url === item.url && e.excerpt === excerpt,
            )
          )
            existing.evidence.push(source);
        } else
          candidates.set(key, {
            code,
            class_date: classDate,
            date_basis: basis,
            match: matches ? "matches_context" : "needs_confirmation",
            evidence: [source],
          });
      }
    }
  }
  return [...candidates.values()].sort(
    (a, b) =>
      Number(b.match === "matches_context") -
      Number(a.match === "matches_context"),
  );
}

export interface AttendanceSource {
  searchAttendance(unit: Unit, query: AttendanceQuery): Promise<EvidenceSearch>;
}

export async function findAttendanceCode(
  unit: Unit,
  query: AttendanceQuery,
  sources: { ed: AttendanceSource; moodle: AttendanceSource },
) {
  assertDate(query.date);
  const names = ["ed", "moodle"] as const;
  const settled = await Promise.allSettled(
    names.map((name) => sources[name].searchAttendance(unit, query)),
  );
  const evidence: Evidence[] = [];
  const coverage: SearchCoverage[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      evidence.push(...result.value.evidence);
      coverage.push(result.value.coverage);
    } else
      coverage.push({
        source: names[index]!,
        status: "unavailable",
        examined: 0,
        reason: "The source could not be searched. Check its connection.",
      });
  });
  const candidates = extractCandidates(unit, query, evidence);
  const confirmedCodes = new Set(
    candidates.filter((c) => c.match === "matches_context").map((c) => c.code),
  );
  const incomplete =
    coverage.some((c) => ["partial", "unavailable"].includes(c.status)) ||
    coverage.every((c) => c.status === "not_configured");
  const status =
    confirmedCodes.size > 1
      ? "ambiguous"
      : incomplete
        ? "partial"
        : confirmedCodes.size === 1
          ? "found"
          : candidates.length
            ? "ambiguous"
            : "not_found";
  return {
    status,
    unit: unit.key,
    date: query.date,
    timezone: unit.timezone,
    candidates,
    coverage,
    note: "Codes are source-backed candidates. Portal validity and submission are not checked.",
  };
}
