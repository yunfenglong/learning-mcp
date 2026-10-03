import { execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  mkdtemp,
  rename,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, posix, resolve } from "node:path";
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("wrangler/package.json"))(
  "esbuild",
);
const entries = {
  ed: {
    repo: "edstem-cli",
    entries: ["src/ed/client.ts"],
    exports: 'export { EdClient } from "./src/ed/client.js";',
  },
  moodle: {
    repo: "moodle-cli",
    entries: ["src/moodle-client-core.ts"],
    exports: 'export { MoodleClientCore } from "./src/moodle-client-core.js";',
  },
  ontrack: {
    repo: "ontrack-cli",
    entries: ["src/ontrack.ts", "src/http.ts"],
    exports:
      'export { OnTrackClient } from "./src/ontrack.js"; export { HttpClient } from "./src/http.js";',
  },
};
function fetchText(url) {
  return execFileSync(
    "curl",
    ["--fail", "--silent", "--show-error", "--max-time", "30", url],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
}
const manifestPath = "vendor/upstreams.json";
const previous = JSON.parse(
  await readFile(manifestPath, "utf8").catch(() => "{}"),
);
const mode = process.argv[2] ?? "check";
if (!["check", "sync", "verify"].includes(mode))
  throw new Error("Usage: pnpm upstreams check | sync | verify");
const manifest = {};
const staging = mode === "sync" ? await mkdtemp("vendor/.sync-") : undefined;
try {
  for (const [platform, entry] of Object.entries(entries)) {
    if (mode === "verify" || mode === "check") {
      const record = previous[platform];
      if (!record) throw new Error(`No upstream lock for ${platform}`);
      for (const [path, hash] of Object.entries(record.files)) {
        const data = await readFile(`vendor/${platform}/${path}`);
        if (createHash("sha256").update(data).digest("hex") !== hash)
          throw new Error(`Modified upstream source: ${platform}/${path}`);
      }
      console.log(`${platform}: verified ${record.sha}`);
      if (mode === "verify") continue;
    }
    const info = JSON.parse(
      fetchText(`https://api.github.com/repos/bunizao/${entry.repo}`),
    );
    const commit = JSON.parse(
      fetchText(
        `https://api.github.com/repos/bunizao/${entry.repo}/commits/${encodeURIComponent(info.default_branch)}`,
      ),
    );
    const sha = commit.sha;
    if (mode === "check") {
      if (previous[platform]?.sha !== sha)
        throw new Error(
          `${platform}: upstream ${sha} differs from lock ${previous[platform]?.sha ?? "missing"}. Run pnpm upstreams sync, then validate.`,
        );
      console.log(`${platform}: current ${sha}`);
      continue;
    }
    const root = `${staging}/${platform}`;
    await mkdir(root, { recursive: true });
    const files = {},
      pending = [...entry.entries, "LICENSE", "package.json"];
    while (pending.length) {
      const path = pending.pop();
      if (files[path]) continue;
      if (
        path.startsWith("../") ||
        path.includes("..\\") ||
        path.startsWith("/")
      )
        throw new Error("Unsafe upstream path");
      const source = fetchText(
        `https://raw.githubusercontent.com/bunizao/${entry.repo}/${sha}/${path}`,
      );
      await mkdir(dirname(`${root}/${path}`), { recursive: true });
      await writeFile(`${root}/${path}`, source);
      files[path] = createHash("sha256").update(source).digest("hex");
      if (!path.endsWith(".ts")) continue;
      for (const match of source.matchAll(
        /(?:from\s*|import\s*\(|import\s*)["'](\.[^"']+)["']/g,
      )) {
        let dependency = posix.normalize(
          posix.join(posix.dirname(path), match[1]),
        );
        dependency = dependency.replace(/\.js$/, ".ts");
        if (!/\.(?:ts|json)$/.test(dependency)) dependency += ".ts";
        if (!files[dependency]) pending.push(dependency);
      }
    }
    const pkg = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
    await writeFile(`${root}/entry.ts`, entry.exports);
    await build({
      absWorkingDir: resolve(root),
      entryPoints: ["entry.ts"],
      outfile: "client.js",
      bundle: true,
      platform: "neutral",
      format: "esm",
      target: "es2023",
      packages: "external",
    });
    files["client.js"] = createHash("sha256")
      .update(await readFile(`${root}/client.js`))
      .digest("hex");
    await writeFile(
      `${root}/client.d.ts`,
      platform === "ed"
        ? "export declare class EdClient { constructor(options: any); [key: string]: any; }\n"
        : platform === "moodle"
          ? "export declare class MoodleClientCore { constructor(baseUrl: string, options: any); [key: string]: any; }\n"
          : "export declare class HttpClient { constructor(options: any); [key: string]: any; }\nexport declare class OnTrackClient { constructor(http: HttpClient); [key: string]: any; }\n",
    );
    for (const path of ["entry.ts", "client.d.ts"])
      files[path] = createHash("sha256")
        .update(await readFile(`${root}/${path}`))
        .digest("hex");
    manifest[platform] = {
      repository: `https://github.com/bunizao/${entry.repo}`,
      branch: info.default_branch,
      sha,
      version: pkg.version,
      license: pkg.license,
      synced_at: new Date().toISOString(),
      files,
    };
    console.log(`${platform}: bundled ${pkg.version} ${sha}`);
  }
  if (mode === "sync") {
    const replaced = [];
    try {
      for (const platform of Object.keys(entries)) {
        const destination = `vendor/${platform}`,
          backup = `${staging}/old-${platform}`;
        const hadOld = await rename(destination, backup)
          .then(() => true)
          .catch((error) => {
            if (error.code === "ENOENT") return false;
            throw error;
          });
        replaced.push({ platform, hadOld });
        await rename(`${staging}/${platform}`, destination);
      }
      const pendingManifest = `${staging}/upstreams.json`;
      await writeFile(
        pendingManifest,
        JSON.stringify(manifest, null, 2) + "\n",
      );
      await rename(pendingManifest, manifestPath);
    } catch (error) {
      for (const { platform, hadOld } of replaced.reverse()) {
        await rm(`vendor/${platform}`, { recursive: true, force: true });
        if (hadOld)
          await rename(`${staging}/old-${platform}`, `vendor/${platform}`);
      }
      throw error;
    }
  }
} finally {
  if (staging) await rm(staging, { recursive: true, force: true });
}
