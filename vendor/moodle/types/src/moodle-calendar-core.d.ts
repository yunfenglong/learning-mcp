import type { CalendarEvent } from "./models.js";
type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export declare function readCalendar(call: Call, getPage: (params: Record<string, string | number>) => Promise<string>, baseUrl: string, days: number, courseId?: number): Promise<CalendarEvent[]>;
export declare function readCalendarMonth(call: Call, baseUrl: string, year: number, month: number, courseId?: number): Promise<CalendarEvent[]>;
export declare function calendarMonthOf(shown: string, language?: string): {
    year: number;
    month: number;
} | undefined;
export declare function calendarIcs(events: CalendarEvent[], baseUrl: string): string;
export {};
