/**
 * A Moodle site root is the install address Moodle calls `wwwroot`: an origin plus an
 * optional install path, such as https://host or https://host/elearning/moodle. It never
 * ends in a slash. Every "is this URL ours" check and every path join goes through here,
 * because comparing origins alone would treat a sibling install on the same host as ours,
 * and `new URL("/path", root)` silently drops the install path.
 */
/** The install path with no trailing slash: "" for a root install, "/moodle" otherwise. */
export declare function siteRootPath(root: string): string;
/** Join a site path such as "/lib/ajax/service.php" (query allowed) onto the site root. */
export declare function siteUrl(root: string, path: string): string;
/** True when `url` is the site root itself or a page inside it. */
export declare function isSiteUrl(root: string, url: string | URL): boolean;
/** The path of `url` relative to the site root ("/mod/forum/view.php"), or null when it is not ours. */
export declare function sitePath(root: string, url: string | URL): string | null;
/** True when two site roots name the same install, ignoring a trailing slash and case in the host. */
export declare function sameSiteRoot(left: string, right: string): boolean;
/** True when `url` is Moodle's sign-in area for this site: where it sends a lapsed session. */
export declare function isSiteLoginUrl(root: string, url: string | URL): boolean;
