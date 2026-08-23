import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { ConfigurationTarget, Position, Uri, window, workspace, WorkspaceEdit } from "vscode";
import type { WorkspaceConfiguration } from "vscode";
import {
  checkedTest,
  setupServerFixture,
  waitForDiagnostics,
  waitForCondition,
} from "./harness.ts";

async function updateTargetPath(
  configuration: WorkspaceConfiguration,
  fileUri: Uri,
  targetPath: string,
  shouldLint: boolean,
): Promise<void> {
  const diagnostics = waitForDiagnostics(
    fileUri,
    (published) => published.length > 0 === shouldLint,
  );
  await Promise.all([
    diagnostics,
    configuration.update("targetPath", targetPath, ConfigurationTarget.Workspace),
  ]);
}

checkedTest("Extension tests > Server integration > Target path matching", async (context) => {
  const { testFile } = await setupServerFixture(context, "README.md");
  const fileUri = Uri.file(testFile);
  const configuration = workspace.getConfiguration("textlint");
  const originalTargetPath = configuration.inspect<string>("targetPath")?.workspaceValue;
  context.after(async () => {
    await configuration.update("targetPath", originalTargetPath, ConfigurationTarget.Workspace);
  });
  const initialDiagnostics = waitForDiagnostics(fileUri);
  await window.showTextDocument(await workspace.openTextDocument(testFile));
  await initialDiagnostics;
  await [
    { targetPath: "*.txt", shouldLint: false },
    { targetPath: "README.md", shouldLint: true },
    { targetPath: "*", shouldLint: true },
    { targetPath: "**/*", shouldLint: true },
  ].reduce(
    (previous, target) =>
      previous.then(() =>
        updateTargetPath(configuration, fileUri, target.targetPath, target.shouldLint),
      ),
    Promise.resolve(),
  );
});

checkedTest("Extension tests > Server integration > Lint on type before save", async (context) => {
  const { testFile } = await setupServerFixture(context, "testtest-on-type.txt");
  const fileUri = Uri.file(testFile);
  const configuration = workspace.getConfiguration("textlint");
  const originalRun = configuration.inspect<string>("run")?.workspaceValue;
  context.after(async () => {
    await configuration.update("run", originalRun, ConfigurationTarget.Workspace);
  });
  await fs.writeFile(testFile, "A clean sentence.\n", "utf8");
  await configuration.update("run", "onType", ConfigurationTarget.Workspace);
  const document = await workspace.openTextDocument(testFile);
  await window.showTextDocument(document);
  const linted = waitForDiagnostics(fileUri);
  const edit = new WorkspaceEdit();
  edit.insert(fileUri, new Position(0, 0), "yuo ");
  await workspace.applyEdit(edit);
  assert.ok((await linted).length > 0, "onType should diagnose an unsaved edit");
  assert.strictEqual(document.isDirty, true);
  assert.strictEqual(await waitForCondition(() => document.isDirty), true);
});
