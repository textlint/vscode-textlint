import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as textlint from "textlint";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import {
  createWorkspaceLinterService,
  selectConfigFile,
  type WorkspaceLinterDependencies,
  type WorkspaceLinterDiscovery,
} from "./workspace-linters.ts";

const settings: WorkspaceLinterDependencies["settings"] = () => ({
  configPath: null,
  ignorePath: null,
  nodePath: null,
  run: "onSave",
  trace: "off",
  targetPath: "",
});

void test("config lookup stops after finding a workspace configuration", () => {
  const configFile = selectConfigFile({
    workspace: () => "/workspace/.textlintrc.json",
    configured: () => assert.fail("configured lookup should not run"),
    home: () => assert.fail("home lookup should not run"),
  });

  assert.strictEqual(configFile, "/workspace/.textlintrc.json");
});

void test("workspace linter reports missing configuration before missing library", async () => {
  const events: string[] = [];
  const dependencies: WorkspaceLinterDependencies = {
    settings,
    trace: () => {},
    notifyNoConfig: () => {
      events.push("no-config");
    },
    notifyNoLibrary: () => {
      events.push("no-library");
    },
  };
  const discovery: WorkspaceLinterDiscovery = {
    findConfig: () => {
      events.push("find-config");
    },
    findIgnore: () => {
      events.push("find-ignore");
    },
    resolveModule: () => {
      events.push("resolve-library");
      return Promise.reject(new Error("missing library"));
    },
  };

  await createWorkspaceLinterService(dependencies, discovery).configure([
    { name: "workspace", uri: "file:///workspace" },
  ]);

  assert.deepStrictEqual(events, ["find-config", "no-config", "resolve-library", "no-library"]);
});

void test("ignore patterns are relative to each workspace folder", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vscode-textlint-ignore-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const folders = await Promise.all(
    [
      { name: "A", pattern: "history/**", expected: ["ignored", "ok"] },
      { name: "B", pattern: "current.md", expected: ["ok", "ignored"] },
    ].map(async ({ name, pattern, expected }) => {
      const root = join(directory, name);
      await mkdir(join(root, "history"), { recursive: true });
      await Promise.all(
        Object.entries({
          ".textlintrc.json": "{}",
          ".textlintignore": `${pattern}\n`,
          "history/old.md": "",
          "current.md": "",
        }).map(([file, content]) => writeFile(join(root, file), content)),
      );
      return { name, root, uri: URI.file(root).toString(), expected };
    }),
  );
  const service = createWorkspaceLinterService(
    {
      settings,
      trace: () => {},
      notifyNoConfig: () => assert.fail("configuration should exist"),
      notifyNoLibrary: () => assert.fail("textlint should be available"),
    },
    {
      findConfig: (root) => join(root, ".textlintrc.json"),
      findIgnore: (root) => join(root, ".textlintignore"),
      resolveModule: () => Promise.resolve(textlint),
    },
  );
  await service.configure(folders);

  await Promise.all(
    folders.map(async (folder) => {
      const document = TextDocument.create(`${folder.uri}/current.md`, "markdown", 1, "");
      const scanFilePath = service.lookup(document)[1]?.linter.scanFilePath;
      assert.ok(scanFilePath, `linter should exist for ${folder.name}`);
      const scans = await Promise.all(
        ["history/old.md", "current.md"].map((file) => scanFilePath(join(folder.root, file))),
      );
      const actual = scans.map((scan) => scan.status);
      assert.deepStrictEqual(actual, folder.expected, folder.name);
    }),
  );
});
