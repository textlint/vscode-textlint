import assert from "node:assert/strict";
import {
  commands,
  DiagnosticSeverity,
  languages,
  Position,
  Uri,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import type { Diagnostic, Disposable } from "vscode";
import type { ExtensionInternal } from "../../src/client/extension.ts";
import {
  checkedTest,
  extensionInternals,
  PublishDiagnosticsNotification,
  setupServerFixture,
  waitForCondition,
  waitForDiagnostics,
  waitForEditorStabilization,
} from "./harness.ts";

const expectedDiagnostics = [
  { line: 0, character: 1 },
  { line: 2, character: 0 },
  { line: 4, character: 1 },
];

function captureDiagnostics(
  internals: ExtensionInternal,
  fileUri: Uri,
  diagnostics: Diagnostic[],
): Disposable {
  return internals.client.onNotification(PublishDiagnosticsNotification.type, (params) => {
    const notificationUri = params.uri.toLowerCase();
    const testFileUri = fileUri.toString().toLowerCase();
    if (
      (notificationUri.includes(testFileUri) || testFileUri.includes(notificationUri)) &&
      params.diagnostics.length > 0
    ) {
      diagnostics.splice(
        0,
        diagnostics.length,
        ...params.diagnostics.map((diagnostic) =>
          internals.client.protocol2CodeConverter.asDiagnostic(diagnostic),
        ),
      );
    }
  });
}

function assertLintDiagnostics(diagnostics: readonly Diagnostic[]): void {
  assert.strictEqual(diagnostics.length, expectedDiagnostics.length);
  for (const [index, diagnostic] of diagnostics.entries()) {
    assert.strictEqual(diagnostic.code, "common-misspellings");
    assert.strictEqual(diagnostic.message, "This is a commonly misspelled word. Correct it to you");
    assert.strictEqual(diagnostic.source, "textlint");
    assert.strictEqual(diagnostic.severity, DiagnosticSeverity.Error);
    assert.deepStrictEqual(
      {
        line: diagnostic.range.start.line,
        character: diagnostic.range.start.character,
      },
      expectedDiagnostics[index],
    );
    assert.deepStrictEqual(
      {
        line: diagnostic.range.end.line,
        character: diagnostic.range.end.character,
      },
      expectedDiagnostics[index],
    );
  }
}

checkedTest("Extension tests > Server integration > Linting", async (context) => {
  const { testFile, disposables } = await setupServerFixture(context);
  const fileUri = Uri.file(testFile);
  const diagnostics: Diagnostic[] = [];
  disposables.push(captureDiagnostics(extensionInternals(), fileUri, diagnostics));
  const document = await workspace.openTextDocument(testFile);
  await window.showTextDocument(document);
  await waitForEditorStabilization();
  const edit = new WorkspaceEdit();
  edit.insert(fileUri, new Position(0, 0), " ");
  await workspace.applyEdit(edit);
  await document.save();
  const received = await waitForCondition(() =>
    diagnostics.some(
      (diagnostic) => diagnostic.range.start.line === 0 && diagnostic.range.start.character === 1,
    ),
  );
  assert.ok(received, "edited-document diagnostics should arrive within 10 seconds");
  assertLintDiagnostics(diagnostics);
});

checkedTest(
  "Extension tests > Server integration > Clear diagnostics on close",
  async (context) => {
    const { testFile } = await setupServerFixture(context, "testtest-close.txt");
    const fileUri = Uri.file(testFile);
    const linted = waitForDiagnostics(fileUri);
    await window.showTextDocument(await workspace.openTextDocument(testFile));
    await linted;
    await commands.executeCommand("workbench.action.closeActiveEditor");
    assert.ok(await waitForCondition(() => languages.getDiagnostics(fileUri).length === 0));
  },
);
