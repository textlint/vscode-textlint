import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkspaceLinterService,
  selectConfigFile,
  type WorkspaceLinterDependencies,
  type WorkspaceLinterDiscovery,
} from "./workspace-linters.ts";

void test("config lookup stops after finding a workspace configuration", () => {
  const explored: string[] = [];
  const configFile = selectConfigFile({
    workspace: () => {
      explored.push("workspace");
      return "/workspace/.textlintrc.json";
    },
    configured: () => {
      explored.push("configured");
      return "/configured/.textlintrc.json";
    },
    home: () => {
      explored.push("home");
      return "/home/user/.textlintrc.json";
    },
  });

  assert.strictEqual(configFile, "/workspace/.textlintrc.json");
  assert.deepStrictEqual(explored, ["workspace"]);
});

void test("workspace linter reports missing configuration before missing library", async () => {
  const events: string[] = [];
  const dependencies: WorkspaceLinterDependencies = {
    settings: () => ({
      configPath: null,
      ignorePath: null,
      nodePath: null,
      run: "onSave",
      trace: "off",
      targetPath: "",
    }),
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
