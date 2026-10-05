export declare const errorCategories: readonly ["usage", "config", "auth", "upstream_contract", "upstream_api", "network", "cancellation", "not_found"];
export type ErrorCategory = (typeof errorCategories)[number];
export declare class CliError extends Error {
    readonly category: ErrorCategory;
    readonly statusCode: number | undefined;
    readonly hint: string | undefined;
    constructor(category: ErrorCategory, message: string, statusCode?: number, hint?: string);
}
export declare function exitCodeFor(category: ErrorCategory): number;
