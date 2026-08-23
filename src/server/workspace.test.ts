import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { URI } from "vscode-uri";
import {
  configCandidatePattern,
  defaultIgnorePath,
  isTarget,
  lookupWorkspaceLinter,
  uriStartsWith,
  type WorkspaceLinter,
} from "./workspace.ts";

const linter = (name: string) =>
  ({
    availableExtensions: [name],
    linter: { lintText: () => Promise.resolve({ filePath: "test.txt", messages: [] }) },
  }) satisfies WorkspaceLinter;

void describe("workspace core", () => {
  void test("derives config and ignore paths", () => {
    assert.strictEqual(
      configCandidatePattern("/workspace"),
      "/workspace/.textlintr{c.js,c.yaml,c.yml,c,c.json}",
    );
    assert.strictEqual(defaultIgnorePath("/workspace", null), "/workspace/.textlintignore");
    assert.strictEqual(defaultIgnorePath("/workspace", "/custom/ignore"), "/custom/ignore");
  });

  void test("matches target paths relative to the workspace", () => {
    const file = URI.parse("file:///workspace/docs/README.md");
    assert.strictEqual(isTarget("file:///workspace", file, ""), true);
    assert.strictEqual(isTarget("file:///workspace", file, "*.md"), true);
    assert.strictEqual(isTarget("file:///workspace", file, "docs/*.md"), true);
    assert.strictEqual(isTarget("file:///workspace", file, "*.txt"), false);
  });

  void test("selects the first matching workspace without substring false positives", () => {
    const parent = linter("parent");
    const nested = linter("nested");
    const entries = [
      ["file:///workspace", parent],
      ["file:///workspace/nested", nested],
    ] as const;

    assert.strictEqual(uriStartsWith("file:///workspace-other/a.md", "file:///workspace"), false);
    assert.deepStrictEqual(
      lookupWorkspaceLinter(entries, { uri: "file:///workspace/nested/a.md" }),
      ["file:///workspace", parent],
    );
    assert.deepStrictEqual(lookupWorkspaceLinter(entries, { uri: "file:///outside/a.md" }), [
      "",
      undefined,
    ]);
  });
});
