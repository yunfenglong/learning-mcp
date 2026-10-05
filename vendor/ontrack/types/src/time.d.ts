export declare class CivilDate {
    #private;
    private constructor();
    static parse(value: string): CivilDate;
    compare(other: CivilDate): -1 | 0 | 1;
    addDays(days: number): CivilDate;
    toString(): string;
}
export declare class Instant {
    #private;
    private constructor();
    static parse(value: string): Instant;
    compare(other: Instant): -1 | 0 | 1;
    toString(): string;
}
export interface Clock {
    readonly now: Instant;
    readonly today: CivilDate;
}
export declare function createClock(override?: string): Clock;
