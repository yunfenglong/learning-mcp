import type { Thread } from "./models.js";
export interface ThreadFilterOptions {
    answered?: boolean;
    category?: string;
    query?: string;
    since?: Date;
    subcategory?: string;
    threadType?: string;
}
export declare function filterThreads(threads: Thread[], options?: ThreadFilterOptions): Thread[];
/** True when the options narrow the list, so one Ed page may not hold enough matches. */
export declare function hasThreadFilters(options: ThreadFilterOptions): boolean;
/** Parse an ISO date, an ISO datetime, or a relative offset such as 7d, 12h, or 2w. */
export declare function parseSince(value: string, now?: Date): Date;
/** True when the thread has a known creation time that falls before the cutoff. */
export declare function isThreadOlderThan(thread: Thread, since: Date): boolean;
