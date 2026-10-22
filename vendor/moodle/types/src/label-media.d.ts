import type { EmbeddedMedia } from "./models.js";
export interface LabelContent {
    media: EmbeddedMedia[];
    restriction: string;
}
export declare function parseLabelMedia(html: string, activityId: number, baseUrl: string): LabelContent | null;
