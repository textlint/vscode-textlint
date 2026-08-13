import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as path from "path";
import { pathToFileURL } from "node:url";

import {
  workspace,
  window,
  commands,
  extensions,
  Uri,
  Position,
  Range,
  WorkspaceEdit,
  DiagnosticSeverity,
  ConfigurationTarget,
  languages,
} from "vscode";
import type { CodeAction, Diagnostic, Disposable, Extension } from "vscode";
import { NotificationType } from "vscode-jsonrpc";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver-types";
import type { CodeAction as LspCodeAction } from "vscode-languageclient/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Range as LspRange, TextEdit as LspTextEdit } from "vscode-languageserver-types";
import type { TextlintMessage } from "@textlint/types";
import { test } from "node:test";
import type { TestContext } from "node:test";

import type { ExtensionInternal } from "../../src/client/extension";
import type * as AutofixModule from "../../src/server/autofix";

const failures: unknown[] = [];
const testPromises: Promise<void>[] = [];
const TEST_TIMEOUT = 90000;
const DIAGNOSTICS_TIMEOUT = 10000;

interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: LspDiagnostic[];
}

const PublishDiagnosticsNotification = {
  type: new NotificationType<PublishDiagnosticsParams>("textDocument/publishDiagnostics"),
};

function checkedTest(name: string, fn: (context: TestContext) => Promise<void> | void): void {
  const testPromise = new Promise<void>((resolve, reject) => {
    // Set timeout for all tests
    test(name, { timeout: TEST_TIMEOUT }, async (context) => {
      await Promise.resolve()
        .then(() => fn(context))
        .then(resolve)
        .catch((error) => {
          failures.push(error);
          reject(error);
          throw error;
        });
    });
  });

  testPromises.push(testPromise);
}

let extension: Extension<ExtensionInternal>;
let internals: ExtensionInternal;

/**
 * Waits for the editor to stabilize for the specified time
 */
const waitForEditorStabilization = async (timeMs = 1000): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, timeMs));
};

/**
 * Waits for a condition to become true with timeout
 */
const waitForCondition = async (condition: () => boolean, maxAttempts = 10, intervalMs = 1000): Promise<boolean> => {
  for (let i = 0; i < maxAttempts; i++) {
    if (condition()) {
      return true;
    }
    await waitForEditorStabilization(intervalMs);
  }
  return false;
};

async function setupExtension(): Promise<void> {
  const ext = extensions.getExtension("3w36zj6.textlint");
  if (!ext) {
    throw new Error("Extension not found");
  }
  if (!ext.isActive) {
    await ext.activate();
  }
  extension = ext;
  internals = ext.exports;

  // Verify extension loaded correctly
  assert.ok(extension.isActive, "Extension not activated");
}

function getWorkspaceRoot(): string {
  const folders = workspace.workspaceFolders;
  if (!folders) {
    throw new Error("Workspace folder not found");
  }
  return folders[0].uri.fsPath;
}

function waitForDiagnostics(uri: Uri): Promise<LspDiagnostic[]> {
  return new Promise((resolve, reject) => {
    const disposable = internals.client.onNotification(PublishDiagnosticsNotification.type, (params) => {
      if (params.uri === uri.toString() && params.diagnostics.length > 0) {
        clearTimeout(timeout);
        disposable.dispose();
        resolve(params.diagnostics);
      }
    });
    const timeout = setTimeout(() => {
      disposable.dispose();
      reject(new Error(`Diagnostics were not published for ${uri.toString()}`));
    }, DIAGNOSTICS_TIMEOUT);
  });
}

function textlintMessage(ruleId: string, range: readonly [number, number], text: string): TextlintMessage {
  return {
    type: "lint",
    ruleId,
    message: ruleId,
    line: 1,
    column: 1,
    index: range[0],
    range,
    loc: {
      start: { line: 1, column: range[0] + 1 },
      end: { line: 1, column: range[1] + 1 },
    },
    severity: 2,
    fix: { range, text },
  };
}

function lspDiagnostic(message: TextlintMessage): LspDiagnostic {
  return {
    source: "textlint",
    code: message.ruleId,
    message: message.message,
    range: {
      start: { line: message.loc.start.line - 1, character: message.loc.start.column - 1 },
      end: { line: message.loc.end.line - 1, character: message.loc.end.column - 1 },
    },
  };
}

async function setupServerFixture(
  context: TestContext,
  testFileName = "testtest2.txt"
): Promise<{
  testFile: string;
  disposables: Disposable[];
}> {
  await setupExtension();

  // Test file paths
  const rootPath = getWorkspaceRoot();
  const sourceFile = path.join(rootPath, "testtest.txt");
  const testFile = path.join(rootPath, testFileName);

  // Event listener disposables
  const disposables: Disposable[] = [];

  context.after(async () => {
    // Close editors
    await commands.executeCommand("workbench.action.closeAllEditors");

    // Delete test file
    await fs.rm(testFile, { force: true });

    // Dispose event listeners
    for (const disposable of disposables) {
      if (disposable && typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }

    // Clear array
    disposables.length = 0;
  });

  // Prepare test file
  await fs.cp(sourceFile, testFile);

  return { testFile, disposables };
}

checkedTest("Extension tests > Activate extension", async () => {
  await setupExtension();

  assert.ok(extension.isActive, "Extension should be active");
  assert.ok(internals.client, "Language client should be initialized");
  assert.ok(internals.statusBar, "Status bar should be initialized");
});

checkedTest("Server unit > Autofix overlap selection", async () => {
  const moduleUrl = pathToFileURL(path.resolve(process.cwd(), "src/server/autofix.ts")).href;
  const { TextlintFixRepository }: typeof AutofixModule = await import(moduleUrl);
  const repo = new TextlintFixRepository();
  const selectedRuleIds = (...messages: TextlintMessage[]) => {
    repo.replace(
      1,
      messages.map((message) => [message, lspDiagnostic(message)])
    );
    return repo.separatedValues().map((fix) => fix.ruleId);
  };

  assert.deepStrictEqual(selectedRuleIds(), []);
  assert.deepStrictEqual(selectedRuleIds(textlintMessage("single", [1, 2], "single")), ["single"]);
  assert.deepStrictEqual(
    selectedRuleIds(textlintMessage("left", [0, 2], "left"), textlintMessage("right", [3, 5], "right")),
    ["left", "right"]
  );

  const short = textlintMessage("short", [0, 5], "short");
  const long = textlintMessage("long", [0, 10], "long");
  const startInsertion = textlintMessage("start-insertion", [0, 0], "start");
  const duplicateStartInsertion = textlintMessage("duplicate-start-insertion", [0, 0], "duplicate");
  const firstInsertion = textlintMessage("first-insertion", [10, 10], "first");
  const secondInsertion = textlintMessage("second-insertion", [10, 10], "second");

  assert.deepStrictEqual(
    selectedRuleIds(short, long, startInsertion, duplicateStartInsertion, firstInsertion, secondInsertion),
    ["duplicate-start-insertion", "start-insertion", "long", "second-insertion", "first-insertion"],
    "Fix All should retain boundary and same-position insertions"
  );

  const document = TextDocument.create("file:///test.txt", "plaintext", 1, "0123456789");
  const edits = repo
    .separatedValues()
    .map((fix) =>
      LspTextEdit.replace(
        LspRange.create(document.positionAt(fix.fix.range[0]), document.positionAt(fix.fix.range[1])),
        fix.fix.text
      )
    );
  assert.strictEqual(TextDocument.applyEdits(document, edits), "duplicatestartlongsecondfirst");
});

checkedTest("Extension tests > Commands registration", async () => {
  await setupExtension();

  const allCommands = await commands.getCommands(true);
  const textlintCommands = allCommands.filter((cmd) => cmd.startsWith("textlint."));
  const expectedCommands = ["textlint.createConfig", "textlint.showOutputChannel"];

  assert.deepStrictEqual(textlintCommands.sort(), expectedCommands.sort(), "Commands should match expected values");
});

checkedTest("Extension tests > Server integration > Target path matching", async (context) => {
  const { testFile } = await setupServerFixture(context, "README.md");
  const fileUri = Uri.file(testFile);
  const config = workspace.getConfiguration("textlint");
  const originalTargetPath = config.inspect<string>("targetPath")?.workspaceValue;
  const fileUriString = fileUri.toString();
  const updateTargetPath = (targetPath: string, shouldLint: boolean) => {
    return new Promise<void>((resolve, reject) => {
      const listener = languages.onDidChangeDiagnostics((event) => {
        const changed = event.uris.some((uri) => uri.toString() === fileUriString);
        const hasDiagnostics = languages.getDiagnostics(fileUri).length > 0;
        if (changed && hasDiagnostics === shouldLint) {
          listener.dispose();
          clearTimeout(timeout);
          resolve();
        }
      });
      const timeout = setTimeout(() => {
        listener.dispose();
        reject(new Error(`"${targetPath}" did not ${shouldLint ? "lint" : "exclude"} README.md`));
      }, DIAGNOSTICS_TIMEOUT);
      config.update("targetPath", targetPath, ConfigurationTarget.Workspace).then(undefined, (error) => {
        listener.dispose();
        clearTimeout(timeout);
        reject(error);
      });
    });
  };

  context.after(async () => {
    await config.update("targetPath", originalTargetPath, ConfigurationTarget.Workspace);
  });

  const doc = await workspace.openTextDocument(testFile);
  await window.showTextDocument(doc);

  for (const [targetPath, shouldLint] of [
    ["*.txt", false],
    ["README.md", true],
    ["*", true],
    ["**/*", true],
  ] as const) {
    await updateTargetPath(targetPath, shouldLint);
  }
});

checkedTest("Extension tests > Server integration > Linting", async (context) => {
  const { testFile, disposables } = await setupServerFixture(context);
  const fileUri = Uri.file(testFile);
  const diagnostics: Diagnostic[] = [];

  // Set up diagnostics notification listener
  const disposable = internals.client.onNotification(PublishDiagnosticsNotification.type, (params) => {
    const notificationUri = params.uri.toString().toLowerCase();
    const testFileUri = fileUri.toString().toLowerCase();

    // Process only diagnostics related to test file
    if (
      (notificationUri.includes(testFileUri) || testFileUri.includes(notificationUri)) &&
      params.diagnostics.length > 0
    ) {
      // Convert and store diagnostics
      diagnostics.length = 0;
      params.diagnostics.forEach((diag) => {
        const vscDiagnostic = internals.client.protocol2CodeConverter.asDiagnostic(diag);
        diagnostics.push(vscDiagnostic);
      });
    }
  });

  disposables.push(disposable);

  // Open test file
  const doc = await workspace.openTextDocument(testFile);
  await window.showTextDocument(doc);
  await waitForEditorStabilization(1000);

  // Modify and save file to trigger linting
  const edit = new WorkspaceEdit();
  edit.insert(fileUri, new Position(0, 0), " ");
  await workspace.applyEdit(edit);
  await doc.save();

  // Wait for diagnostics of the edited content; the didOpen lint publishes
  // diagnostics for the pre-edit content first
  const received = await waitForCondition(() =>
    diagnostics.some((diag) => diag.range.start.line === 0 && diag.range.start.character === 1)
  );
  assert.ok(received, "Should receive diagnostics for the edited document within 10 seconds");

  // Expected diagnostics
  const expectedDiagnostics = [
    {
      code: "common-misspellings",
      message: "This is a commonly misspelled word. Correct it to you",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 1 },
      },
      severity: DiagnosticSeverity.Error,
      source: "textlint",
    },
    {
      code: "common-misspellings",
      message: "This is a commonly misspelled word. Correct it to you",
      range: {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 0 },
      },
      severity: DiagnosticSeverity.Error,
      source: "textlint",
    },
    {
      code: "common-misspellings",
      message: "This is a commonly misspelled word. Correct it to you",
      range: {
        start: { line: 4, character: 1 },
        end: { line: 4, character: 1 },
      },
      severity: DiagnosticSeverity.Error,
      source: "textlint",
    },
  ];

  // Verify diagnostic count
  assert.strictEqual(
    diagnostics.length,
    expectedDiagnostics.length,
    "Number of diagnostics should match expected count"
  );

  // Verify each diagnostic
  for (let i = 0; i < expectedDiagnostics.length; i++) {
    const actual = diagnostics[i];
    const expected = expectedDiagnostics[i];

    assert.strictEqual(actual.code, expected.code, `Diagnostic[${i}] code should match expected value`);
    assert.strictEqual(actual.message, expected.message, `Diagnostic[${i}] message should match expected value`);
    assert.strictEqual(actual.source, expected.source, `Diagnostic[${i}] source should match expected value`);
    assert.strictEqual(actual.severity, expected.severity, `Diagnostic[${i}] severity should match expected value`);

    // Verify position information
    assert.deepStrictEqual(
      {
        startLine: actual.range.start.line,
        startChar: actual.range.start.character,
        endLine: actual.range.end.line,
        endChar: actual.range.end.character,
      },
      {
        startLine: expected.range.start.line,
        startChar: expected.range.start.character,
        endLine: expected.range.end.line,
        endChar: expected.range.end.character,
      },
      `Diagnostic[${i}] range should match expected values`
    );
  }
});

checkedTest("Extension tests > Server integration > Autofix", async (context) => {
  const { testFile } = await setupServerFixture(context, "testtest-autofix.txt");
  const fileUri = Uri.file(testFile);
  const linted = waitForDiagnostics(fileUri);
  const doc = await workspace.openTextDocument(testFile);
  await window.showTextDocument(doc);
  const edit = new WorkspaceEdit();
  edit.insert(fileUri, doc.positionAt(doc.getText().length), " ");
  await workspace.applyEdit(edit);
  const diagnostics = await linted;
  const documentRange = new Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
  const codeActions = (kind?: string) =>
    commands.executeCommand<CodeAction[]>("vscode.executeCodeActionProvider", fileUri, documentRange, kind);
  const editsOf = (action: CodeAction) =>
    (action.edit?.get(fileUri) ?? []).map(({ range, newText }) => ({
      range: {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character },
      },
      newText,
    }));
  const expectedEdits = [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 3 },
      },
      newText: "you",
    },
    {
      range: {
        start: { line: 2, character: 0 },
        end: { line: 2, character: 3 },
      },
      newText: "you",
    },
    {
      range: {
        start: { line: 4, character: 1 },
        end: { line: 4, character: 4 },
      },
      newText: "you",
    },
  ];

  const sourceFixAll = (await codeActions("source.fixAll.textlint")).find(
    (action) => action.kind?.value === "source.fixAll.textlint"
  );
  assert.ok(sourceFixAll?.edit, "source.fixAll.textlint should provide a workspace edit");
  assert.strictEqual(sourceFixAll.command, undefined, "source.fixAll.textlint should not use a command");
  assert.deepStrictEqual(editsOf(sourceFixAll), expectedEdits);

  const genericFixAllActions = await codeActions("source.fixAll");
  assert.ok(
    genericFixAllActions.some((action) => action.kind?.value === "source.fixAll.textlint" && action.edit !== undefined),
    "A generic source.fixAll request should include the textlint fix-all action"
  );

  const concurrentFixAllActions = await Promise.all([
    codeActions("source.fixAll.textlint"),
    codeActions("source.fixAll.textlint"),
  ]);
  assert.ok(
    concurrentFixAllActions.every((actions) =>
      actions.some((action) => action.kind?.value === "source.fixAll.textlint" && action.edit)
    ),
    "Concurrent source.fixAll.textlint requests should both receive edits"
  );

  const unfilteredActions = await codeActions();
  assert.ok(
    unfilteredActions.every((action) => action.kind?.value !== "source.fixAll.textlint"),
    "An unfiltered lightbulb request should not include source.fixAll.textlint"
  );

  const quickFixResult = await internals.client.sendRequest<LspCodeAction[] | null>("textDocument/codeAction", {
    textDocument: { uri: fileUri.toString() },
    range: internals.client.code2ProtocolConverter.asRange(documentRange),
    context: { diagnostics, only: ["quickfix"] },
  });
  const quickFixes = await Promise.all(
    (quickFixResult ?? []).map((action) => internals.client.protocol2CodeConverter.asCodeAction(action))
  );
  const singleFix = quickFixes.find((action) => action.title === "Fix this common-misspellings problem");
  const sameRuleFixes = quickFixes.filter((action) => action.title === "Fix all common-misspellings problems");
  assert.ok(singleFix?.edit, "A single-problem Quick Fix should provide a workspace edit");
  assert.deepStrictEqual(editsOf(singleFix), expectedEdits.slice(0, 1));
  assert.strictEqual(sameRuleFixes.length, 1, "A same-rule Quick Fix should not be duplicated");
  assert.deepStrictEqual(editsOf(sameRuleFixes[0]), expectedEdits);
  assert.ok(
    quickFixes.every((action) => action.edit !== undefined && action.command === undefined),
    "Quick Fix actions should carry edits directly"
  );

  await workspace.applyEdit(sourceFixAll.edit);
  const fixed = await waitForCondition(() => !doc.getText().includes("yuo"));
  assert.ok(fixed, "The source.fixAll.textlint edit should fix all auto-fixable problems");
});

checkedTest("Extension tests > Server integration > Code Actions on Save", async (context) => {
  const { testFile } = await setupServerFixture(context, "testtest-fix-on-save.txt");
  const fileUri = Uri.file(testFile);
  const linted = waitForDiagnostics(fileUri);
  const editorConfig = workspace.getConfiguration("editor");
  const originalCodeActionsOnSave =
    editorConfig.inspect<Record<string, string | boolean>>("codeActionsOnSave")?.workspaceValue;

  context.after(async () => {
    await editorConfig.update("codeActionsOnSave", originalCodeActionsOnSave, ConfigurationTarget.Workspace);
  });

  await editorConfig.update(
    "codeActionsOnSave",
    {
      ...originalCodeActionsOnSave,
      "source.fixAll.textlint": "explicit",
    },
    ConfigurationTarget.Workspace
  );

  const doc = await workspace.openTextDocument(testFile);
  await window.showTextDocument(doc);
  await linted;

  const edit = new WorkspaceEdit();
  edit.insert(fileUri, doc.positionAt(doc.getText().length), " ");
  await workspace.applyEdit(edit);
  await doc.save();

  const fixed = await waitForCondition(() => !doc.getText().includes("yuo"));
  assert.ok(fixed, "source.fixAll.textlint should apply fixes on save");
});

export const testsDone = Promise.all(testPromises).then(async () => {
  if (failures.length > 0) {
    throw failures[0];
  }

  await waitForEditorStabilization(250);
});

// References:
// https://github.com/Microsoft/vscode-mssql/blob/dev/test/initialization.test.ts
// https://github.com/HookyQR/VSCodeBeautify/blob/master/test/extension.test.js
// https://github.com/Microsoft/vscode-docs/blob/master/docs/extensionAPI/vscode-api-commands.md
// https://github.com/Microsoft/vscode-docs/blob/master/docs/extensionAPI/vscode-api.md
