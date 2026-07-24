import * as assert from "assert";
import * as fs from "node:fs/promises";
import * as path from "path";

import {
  workspace,
  window,
  commands,
  extensions,
  Uri,
  Position,
  WorkspaceEdit,
  DiagnosticSeverity,
  ConfigurationTarget,
  languages,
} from "vscode";
import type { Diagnostic, Disposable, Extension } from "vscode";
import { NotificationType } from "vscode-jsonrpc";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver-types";
import type { TextEdit } from "vscode-languageclient/node";
import { test } from "node:test";
import type { TestContext } from "node:test";

import type { ExtensionInternal } from "../../src/client/extension";

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

checkedTest("Extension tests > Commands registration", async () => {
  await setupExtension();

  const allCommands = await commands.getCommands(true);
  const textlintCommands = allCommands.filter((cmd) => cmd.startsWith("textlint."));
  const expectedCommands = [
    "textlint.createConfig",
    "textlint.applyTextEdits",
    "textlint.executeAutofix",
    "textlint.showOutputChannel",
  ];

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
  const { testFile, disposables } = await setupServerFixture(context);

  // Fix completion flag and applied edits
  let appliedEdits: TextEdit[] = [];

  // Set up fix completion listener
  const fixDisposable = internals.onAllFixesComplete((_, edits) => {
    appliedEdits = edits || [];
  });
  if (fixDisposable && typeof fixDisposable.dispose === "function") {
    disposables.push(fixDisposable);
  }

  // Open test file
  const doc = await workspace.openTextDocument(testFile);
  await window.showTextDocument(doc);
  await waitForEditorStabilization(5000);

  // Execute autofix command
  await commands.executeCommand("textlint.executeAutofix");
  await waitForEditorStabilization(5000);

  // Expected edits
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

  // Verify edits were applied
  assert.ok(appliedEdits.length > 0, "At least one edit should be applied");

  // Verify each edit
  for (let i = 0; i < expectedEdits.length; i++) {
    const actual = appliedEdits[i];
    const expected = expectedEdits[i];

    assert.strictEqual(actual.newText, expected.newText, `Edit[${i}] newText should match expected value`);
    assert.strictEqual(
      actual.range.start.line,
      expected.range.start.line,
      `Edit[${i}] range.start.line should match expected value`
    );
    assert.strictEqual(
      actual.range.start.character,
      expected.range.start.character,
      `Edit[${i}] range.start.character should match expected value`
    );
    assert.strictEqual(
      actual.range.end.line,
      expected.range.end.line,
      `Edit[${i}] range.end.line should match expected value`
    );
    assert.strictEqual(
      actual.range.end.character,
      expected.range.end.character,
      `Edit[${i}] range.end.character should match expected value`
    );
  }
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
