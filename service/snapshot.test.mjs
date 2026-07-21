import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readGitCommit } from "./read-git-commit.mjs";
import { startMirrorServer } from "./server.mjs";
import { buildSnapshot } from "./snapshot.mjs";

const generation = "a".repeat(40);

test("从 Dokploy clone 的 loose 或 packed Git ref 读取部署提交", (context) => {
  const root = mkdtempSync(join(tmpdir(), "lume-market-git-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const gitDir = join(root, ".git");
  mkdirSync(join(gitDir, "refs", "heads"), { recursive: true });
  writeFileSync(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(gitDir, "refs", "heads", "main"), `${generation}\n`);
  assert.equal(readGitCommit(gitDir), generation);
  rmSync(join(gitDir, "refs", "heads", "main"));
  writeFileSync(join(gitDir, "packed-refs"), `${"b".repeat(40)} refs/heads/main\n`);
  assert.equal(readGitCommit(gitDir), "b".repeat(40));
});

test("生成不可变镜像并提供 catalog/raw/archive", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "lume-market-mirror-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source");
  mkdirSync(join(source, ".lume-plugin"), { recursive: true });
  mkdirSync(join(source, "plugins", "healthy", "package"), { recursive: true });
  mkdirSync(join(source, "plugins", "broken"), { recursive: true });
  mkdirSync(join(source, "skills"), { recursive: true });
  writeJson(join(source, ".lume-plugin", "marketplace.json"), {
    plugins: [{ name: "healthy", source: "./plugins/healthy" }, { name: "broken", source: "./plugins/broken" }],
  });
  writeJson(join(source, "plugins", "healthy", "lume-plugin.json"), {
    schema: "lume-plugin/v1",
    name: "healthy",
    version: "1.0.0",
    marketplace: { setup: [{ id: "export", artifact: { path: "./package", kind: "file" } }] },
  });
  writeFileSync(join(source, "plugins", "healthy", "README.md"), "# Healthy");
  writeFileSync(join(source, "plugins", "healthy", "package", "main.js"), "ok");
  writeJson(join(source, "plugins", "broken", "lume-plugin.json"), {
    schema: "lume-plugin/v1",
    name: "broken",
    version: "1.0.0",
    marketplace: { icon: "./assets/missing.svg" },
  });
  const config = {
    host: "127.0.0.1",
    port: 0,
    sourceRoot: source,
    dataDir: join(root, "data"),
    generation,
    owner: "acme",
    repo: "plugins",
    ref: "main",
    repositoryUrl: "https://github.com/acme/plugins",
  };
  const snapshot = await buildSnapshot(config);
  assert.deepEqual(snapshot.plugins.map((plugin) => plugin.id), ["healthy"]);
  assert.equal(snapshot.plugins[0].manifest.name, "healthy");
  assert.equal(snapshot.diagnostics[0].itemId, "broken");

  const { server } = await startMirrorServer(config);
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const catalog = await fetch(`${base}/v1/catalog`);
  assert.equal(catalog.status, 200);
  assert.equal(catalog.headers.get("etag"), `\"${generation}\"`);
  assert.equal((await fetch(`${base}/v1/catalog`, { headers: { "If-None-Match": `\"${generation}\"` } })).status, 304);
  assert.equal(await (await fetch(`${base}/v1/snapshots/${generation}/raw/plugins/healthy/README.md`)).text(), "# Healthy");
  assert.equal((await fetch(`${base}/v1/snapshots/${generation}/archive.tar.gz`)).status, 200);
});

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}
