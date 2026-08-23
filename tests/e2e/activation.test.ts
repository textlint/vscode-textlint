import assert from "node:assert/strict";
import { commands } from "vscode";
import { checkedTest, setupExtension } from "./harness.ts";

checkedTest("Extension tests > Activate extension", async () => {
  const { extension, internals } = await setupExtension();
  assert.ok(extension.isActive, "Extension should be active");
  assert.notStrictEqual(internals.client, undefined, "Language client should be initialized");
  assert.notStrictEqual(internals.statusBar, undefined, "Status bar should be initialized");
});

checkedTest("Extension tests > Commands registration", async () => {
  await setupExtension();
  const textlintCommands = (await commands.getCommands(true)).filter((command) =>
    command.startsWith("textlint."),
  );
  assert.deepStrictEqual(textlintCommands.toSorted(), [
    "textlint.createConfig",
    "textlint.showOutputChannel",
  ]);
});
