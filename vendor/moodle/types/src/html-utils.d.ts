export interface StructuredHtmlContent {
    text: string;
    image_urls: string[];
    links: Array<{
        text: string;
        url: string;
    }>;
    tables: Array<{
        headers: string[];
        rows: string[][];
    }>;
}
export declare function htmlToStructuredContent(html: string, baseUrl: string): StructuredHtmlContent;
export declare function cleanText(value: string | null | undefined): string;
export declare function resolveUrl(baseUrl: string, href: string): string;
