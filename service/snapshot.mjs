import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ASSET_BYTES = 512 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_ARTIFACT_FILES = 20_000;

export async function buildSnapshot(config) {
  const generations = join(config.dataDir, "generations");
  const destination = join(generations, config.generation);
  const catalogPath = join(destination, "catalog.json");
  if (existsSync(catalogPath)) return JSON.parse(await readFile(catalogPath, "utf8"));

  await mkdir(generations, { recursive: true });
  const staging = join(generations, `.staging-${process.pid}-${Date.now()}`);
  try {
    const source = await realpath(config.sourceRoot);
    const manifest = JSON.parse(await readBoundedText(join(source, ".lume-plugin", "marketplace.json"), MAX_MANIFEST_BYTES));
    const snapshot = await createCatalog(config, source, manifest);
    const repository = join(staging, "repo");
    await mkdir(repository, { recursive: true });
    for (const name of [".lume-plugin", "plugins", "skills"]) {
      const from = join(source, name);
      if (existsSync(from)) {
        await rejectSymlinks(from);
        await cp(from, join(repository, name), { recursive: true, errorOnExist: true });
      }
    }
    await execFileAsync("tar", ["-czf", join(staging, "archive.tar.gz"), "-C", repository, "."], {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    await writeFile(join(staging, "catalog.json"), JSON.stringify(snapshot), "utf8");
    await rename(staging, destination);
    await writeFile(join(config.dataDir, "current"), config.generation, "utf8");
    await pruneGenerations(generations, config.generation);
    return snapshot;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function createCatalog(config, sourceRoot, manifest) {
  const diagnostics = [];
  const plugins = [];
  for (const entry of Array.isArray(manifest.plugins) ? manifest.plugins : []) {
    try {
      const subdir = normalizeRelativePath(entry.source);
      const pluginRoot = await assertContainedDirectory(sourceRoot, join(sourceRoot, subdir));
      const pluginManifest = JSON.parse(await readBoundedText(join(pluginRoot, "lume-plugin.json"), MAX_MANIFEST_BYTES));
      if (pluginManifest.schema !== "lume-plugin/v1") throw new Error("schema must be lume-plugin/v1");
      if (pluginManifest.name !== entry.name) throw new Error("market entry name does not match lume-plugin.json");
      if (typeof pluginManifest.version !== "string") throw new Error("plugin version is missing");
      await validateDeclaredFiles(pluginRoot, pluginManifest);
      const readme = (await readdir(pluginRoot)).find((name) => name.toLowerCase() === "readme.md");
      plugins.push({
        id: entry.name,
        name: entry.name,
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.version ? { version: entry.version } : {}),
        subdir,
        manifest: pluginManifest,
        ...(readme ? { readmePath: posix.join(subdir, readme) } : {}),
      });
    } catch (error) {
      diagnostics.push({ itemId: entry?.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const skills = [];
  for (const entry of Array.isArray(manifest.skills) ? manifest.skills : []) {
    try {
      skills.push({
        id: entry.name,
        name: entry.name,
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.version ? { version: entry.version } : {}),
        subdir: normalizeRelativePath(entry.source),
      });
    } catch (error) {
      diagnostics.push({ itemId: entry?.name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    schema: "lume-plugin-market-mirror/v1",
    generation: config.generation,
    generatedAt: new Date().toISOString(),
    source: {
      owner: config.owner,
      repo: config.repo,
      ref: config.ref,
      commit: config.generation,
      url: config.repositoryUrl,
    },
    archivePath: `/v1/snapshots/${config.generation}/archive.tar.gz`,
    rawBasePath: `/v1/snapshots/${config.generation}/raw/`,
    diagnostics,
    plugins,
    skills,
  };
}

async function validateDeclaredFiles(root, manifest) {
  for (const asset of [manifest.marketplace?.icon, manifest.marketplace?.thumbnail, manifest.marketplace?.hero]) {
    const assetPath = typeof asset === "string" ? asset : asset?.path;
    if (assetPath) await inspectTree(await assertContainedPath(root, join(root, normalizeRelativePath(assetPath))), MAX_ASSET_BYTES, 1);
  }
  for (const step of Array.isArray(manifest.marketplace?.setup) ? manifest.marketplace.setup : []) {
    for (const artifact of [step?.artifact, ...(Array.isArray(step?.artifacts) ? step.artifacts : [])]) {
      if (!artifact?.path) continue;
      await inspectTree(
        await assertContainedPath(root, join(root, normalizeRelativePath(artifact.path))),
        MAX_ARTIFACT_BYTES,
        MAX_ARTIFACT_FILES,
      );
    }
    if (step?.download?.url && new URL(step.download.url).protocol !== "https:") {
      throw new Error(`setup ${step.id ?? "unknown"} download must use HTTPS`);
    }
  }
}

async function rejectSymlinks(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(root, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`symlink is not allowed: ${path}`);
    if (info.isDirectory()) await rejectSymlinks(path);
  }
}

async function inspectTree(path, maxBytes, maxFiles) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error(`unsupported entry: ${basename(path)}`);
  if (info.isFile()) {
    if (info.nlink > 1 || info.size > maxBytes) throw new Error(`unsafe or oversized entry: ${basename(path)}`);
    return { bytes: info.size, files: 1 };
  }
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(path)) {
    const child = await inspectTree(join(path, entry), maxBytes - bytes, maxFiles - files);
    bytes += child.bytes;
    files += child.files;
    if (bytes > maxBytes || files > maxFiles) throw new Error(`package tree exceeds mirror limits: ${basename(path)}`);
  }
  return { bytes, files };
}

async function assertContainedDirectory(root, path) {
  const contained = await assertContainedPath(root, path);
  if (!(await stat(contained)).isDirectory()) throw new Error(`plugin source is not a directory: ${path}`);
  return contained;
}

async function assertContainedPath(root, path) {
  const resolvedRoot = await realpath(root);
  const resolvedPath = await realpath(path);
  const rel = relative(resolvedRoot, resolvedPath);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes repository: ${path}`);
  let cursor = resolvedRoot;
  for (const segment of rel.split(/[\\/]+/).filter(Boolean)) {
    cursor = join(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`symlink is not allowed: ${path}`);
  }
  return resolvedPath;
}

function normalizeRelativePath(value) {
  if (typeof value !== "string") throw new Error("repository-relative path is missing");
  const normalized = posix.normalize(value.replace(/\\/g, "/").replace(/^\.\//, ""));
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw new Error(`invalid repository-relative path: ${value}`);
  }
  return normalized;
}

async function readBoundedText(path, maxBytes) {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBytes) throw new Error(`file exceeds ${maxBytes} bytes: ${path}`);
  return readFile(path, "utf8");
}

async function pruneGenerations(root, current) {
  const generations = await Promise.all((await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{40}$/.test(entry.name))
    .map(async (entry) => ({ name: entry.name, modified: (await stat(join(root, entry.name))).mtimeMs })));
  generations.sort((left, right) => right.modified - left.modified);
  const keep = new Set([current, ...generations.slice(0, 2).map((entry) => entry.name)]);
  for (const generation of generations) {
    if (!keep.has(generation.name)) await rm(join(root, generation.name), { recursive: true, force: true });
  }
}
