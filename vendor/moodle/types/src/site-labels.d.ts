/** English label as the readers match it → the language strings a site may show instead. */
export declare const LABEL_STRINGS: Readonly<Record<string, ReadonlyArray<readonly [component: string, id: string]>>>;
/** English label → the texts the site shows for it. Empty when the site could not be asked. */
export type SiteLabels = Readonly<Record<string, readonly string[]>>;
export declare function labelRequests(): Array<{
    stringid: string;
    component: string;
}>;
/** Builds the label map from core_get_strings' answer; strings the site lacks come back as [[id]]. */
export declare function siteLabelsFrom(data: unknown): SiteLabels;
/** Compares labels the way a page shows them: case, spacing and a trailing colon do not matter. */
export declare function labelKey(text: string): string;
/** Every text that stands for `label` on this site, the English one first. */
export declare function labelTexts(label: string, labels?: SiteLabels): string[];
