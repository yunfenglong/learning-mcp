import pdf2md from "@opendocsg/pdf2md";
import { SuiteError } from "../../errors.ts";

// Match the pinned OnTrack converter and its limits; retain remote pagination.
export async function taskMarkdown(
  bytes: Uint8Array,
  title: string,
  start: number,
  count: number,
) {
  let pages = 0;
  let document:
    | {
        cleanup?: (keepFonts?: boolean) => Promise<void>;
        destroy?: () => Promise<void>;
      }
    | undefined;
  const clean = (value: string) =>
    value
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "")
      .replace(/\r\n?/gu, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, "")
      .trim();
  try {
    const body = clean(
      await pdf2md(bytes.slice(), {
        documentParsed(value) {
          document = value;
          pages = value.numPages;
          if (pages < 1 || pages > 200)
            throw new SuiteError(
              "FILE_TOO_LARGE",
              "Task sheets are limited to 200 pages.",
            );
        },
      }),
    );
    if (!body)
      throw new SuiteError(
        "UPSTREAM_CONTRACT_ERROR",
        "Task sheet contains no extractable text.",
        502,
      );
    if (new TextEncoder().encode(body).length > 4 * 1024 * 1024)
      throw new SuiteError(
        "FILE_TOO_LARGE",
        "Task-sheet Markdown exceeds 4 MiB.",
      );
    if (start > pages)
      throw new SuiteError(
        "INVALID_INPUT",
        "The selected page is outside this task sheet.",
      );
    const end = Math.min(pages, start + count - 1);
    const markdown = `# ${clean(title).replace(/\s+/gu, " ")}\n\n${body
      .split("<!-- PAGE_BREAK -->")
      .slice(start - 1, end)
      .join("<!-- PAGE_BREAK -->")}\n`;
    if (new TextEncoder().encode(markdown).length > 4 * 1024 * 1024)
      throw new SuiteError(
        "FILE_TOO_LARGE",
        "Task-sheet Markdown exceeds 4 MiB.",
      );
    return {
      markdown,
      total_pages: pages,
      first_page: start,
      last_page: end,
      next_page: end < pages ? end + 1 : null,
      coverage: "extractable_text",
      converter: "@opendocsg/pdf2md@0.2.7",
      reason:
        "Scanned pages and images require the PDF; this converter does not perform OCR.",
    };
  } catch (error) {
    if (error instanceof SuiteError) throw error;
    throw new SuiteError(
      "UPSTREAM_CONTRACT_ERROR",
      "OnTrack returned a task sheet that could not be converted to Markdown.",
      502,
    );
  } finally {
    await document?.cleanup?.(false).catch(() => {});
    await document?.destroy?.().catch(() => {});
  }
}
