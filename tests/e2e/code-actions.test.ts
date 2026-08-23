import assert from "node:assert/strict";
import {
  commands,
  ConfigurationTarget,
  Range,
  Uri,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import type { CodeAction } from "vscode";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver-types";
import type { CodeAction as LspCodeAction } from "vscode-languageclient/node";
import {
  checkedTest,
  extensionInternals,
  setupServerFixture,
  waitForCondition,
  waitForDiagnostics,
} from "./harness.ts";

type ComparablePosition = { line: number; character: number };
type ComparableEdit = {
  range: { start: ComparablePosition; end: ComparablePosition };
  newText: string;
};
type CodeActionQuery = (kind?: string) => PromiseLike<CodeAction[]>;

const expectedEdits = [
  { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: "you" },
  { range: { start: { line: 2, character: 0 }, end: { line: 2, character: 3 } }, newText: "you" },
  { range: { start: { line: 4, character: 1 }, end: { line: 4, character: 4 } }, newText: "you" },
];

function editsOf(action: CodeAction, fileUri: Uri): ComparableEdit[] {
  return (action.edit?.get(fileUri) ?? []).map(({ range, newText }) => ({
    range: {
      start: { line: range.start.line, character: range.start.character },
      end: { line: range.end.line, character: range.end.character },
    },
    newText,
  }));
}

async function verifySourceFixAll(query: CodeActionQuery, fileUri: Uri): Promise<CodeAction> {
  const sourceFixAll = (await query("source.fixAll.textlint")).find(
    (action) => action.kind?.value === "source.fixAll.textlint",
  );
  assert.ok(sourceFixAll?.edit);
  assert.strictEqual(sourceFixAll.command, undefined);
  assert.deepStrictEqual(editsOf(sourceFixAll, fileUri), expectedEdits);
  assert.ok(
    (await query("source.fixAll")).some(
      (action) => action.kind?.value === "source.fixAll.textlint" && action.edit !== undefined,
    ),
  );
  const concurrent = await Promise.all([
    query("source.fixAll.textlint"),
    query("source.fixAll.textlint"),
  ]);
  assert.ok(
    concurrent.every((actions) =>
      actions.some((action) => action.kind?.value === "source.fixAll.textlint"),
    ),
  );
  assert.ok((await query()).every((action) => action.kind?.value !== "source.fixAll.textlint"));
  return sourceFixAll;
}

async function verifyQuickFixes(
  fileUri: Uri,
  documentRange: Range,
  diagnostics: LspDiagnostic[],
): Promise<void> {
  const internals = extensionInternals();
  const result = await internals.client.sendRequest<LspCodeAction[] | null>(
    "textDocument/codeAction",
    {
      textDocument: { uri: fileUri.toString() },
      range: internals.client.code2ProtocolConverter.asRange(documentRange),
      context: { diagnostics, only: ["quickfix"] },
    },
  );
  const fixes = await Promise.all(
    (result ?? []).map((action) => internals.client.protocol2CodeConverter.asCodeAction(action)),
  );
  const single = fixes.find((action) => action.title === "Fix this common-misspellings problem");
  const sameRule = fixes.filter(
    (action) => action.title === "Fix all common-misspellings problems",
  );
  assert.ok(single?.edit);
  assert.deepStrictEqual(editsOf(single, fileUri), expectedEdits.slice(0, 1));
  assert.strictEqual(sameRule.length, 1);
  assert.deepStrictEqual(editsOf(sameRule[0], fileUri), expectedEdits);
  assert.ok(fixes.every((action) => action.edit !== undefined && action.command === undefined));
}

checkedTest("Extension tests > Server integration > Autofix", async (context) => {
  const { testFile } = await setupServerFixture(context, "testtest-autofix.txt");
  const fileUri = Uri.file(testFile);
  const linted = waitForDiagnostics(fileUri);
  const document = await workspace.openTextDocument(testFile);
  await window.showTextDocument(document);
  const edit = new WorkspaceEdit();
  edit.insert(fileUri, document.positionAt(document.getText().length), " ");
  await workspace.applyEdit(edit);
  const diagnostics = await linted;
  const documentRange = new Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  const query: CodeActionQuery = (kind) =>
    commands.executeCommand("vscode.executeCodeActionProvider", fileUri, documentRange, kind);
  const sourceFixAll = await verifySourceFixAll(query, fileUri);
  await verifyQuickFixes(fileUri, documentRange, diagnostics);
  await workspace.applyEdit(sourceFixAll.edit!);
  assert.ok(await waitForCondition(() => !document.getText().includes("yuo")));
});

checkedTest("Extension tests > Server integration > Code Actions on Save", async (context) => {
  const { testFile } = await setupServerFixture(context, "testtest-fix-on-save.txt");
  const fileUri = Uri.file(testFile);
  const linted = waitForDiagnostics(fileUri);
  const configuration = workspace.getConfiguration("editor");
  const original =
    configuration.inspect<Record<string, string | boolean>>("codeActionsOnSave")?.workspaceValue;
  context.after(async () => {
    await configuration.update("codeActionsOnSave", original, ConfigurationTarget.Workspace);
  });
  await configuration.update(
    "codeActionsOnSave",
    { ...original, "source.fixAll.textlint": "explicit" },
    ConfigurationTarget.Workspace,
  );
  const document = await workspace.openTextDocument(testFile);
  await window.showTextDocument(document);
  await linted;
  const edit = new WorkspaceEdit();
  edit.insert(fileUri, document.positionAt(document.getText().length), " ");
  await workspace.applyEdit(edit);
  await document.save();
  assert.ok(await waitForCondition(() => !document.getText().includes("yuo")));
});
