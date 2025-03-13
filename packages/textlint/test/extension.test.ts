import * as assert from "assert";
import * as fs from "fs-extra";
import * as path from "path";

import {
  workspace,
  window,
  commands,
  Extension,
  extensions,
  Disposable,
  Uri,
  Position,
  WorkspaceEdit,
  Diagnostic,
  DiagnosticSeverity,
} from "vscode";
import { ExtensionInternal } from "../src/extension";

import { PublishDiagnosticsNotification } from "./types";
import { TextEdit } from "vscode-languageclient/node";

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

suite("Extension tests", function () {
  // Set timeout for all tests
  this.timeout(90000);

  let extension: Extension<ExtensionInternal>;
  let internals: ExtensionInternal;

  setup(async () => {
    try {
      await commands.executeCommand("textlint.showOutputChannel");
      const ext = extensions.getExtension("3w36zj6.textlint");
      if (!ext.isActive) {
        await ext.activate();
      }
      extension = ext;
      internals = ext.exports;

      // Verify extension loaded correctly
      assert(extension, "Extension not found");
      assert(extension.isActive, "Extension not activated");
    } catch (e) {
      console.error("Extension setup failed:", e);
      throw e;
    }
  });

  suite("Basic behavior", () => {
    test("Activate extension", () => {
      assert(extension.isActive, "Extension should be active");
      assert(internals.client, "Language client should be initialized");
      assert(internals.statusBar, "Status bar should be initialized");
    });

    test("Commands registration", async () => {
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
  });

  suite("Server integration", () => {
    // Test file paths
    const rootPath = workspace.workspaceFolders[0].uri.fsPath;
    const sourceFile = path.join(rootPath, "testtest.txt");
    const testFile = path.join(rootPath, "testtest2.txt");

    // Event listener disposables
    const disposables: Disposable[] = [];

    setup(async () => {
      try {
        // Restart language server
        if (typeof internals.client.stop === "function") {
          await internals.client.stop();
        }
        if (typeof internals.client.start === "function") {
          await internals.client.start();
        }
        await internals.client.onReady();

        // Prepare test file
        await fs.copy(sourceFile, testFile);
        const exists = await fs.pathExists(testFile);

        if (!exists) {
          throw new Error(`Test file could not be created: ${testFile}`);
        }
      } catch (e) {
        console.error("Server restart or file preparation failed:", e);
        throw e;
      }
    });

    teardown(async () => {
      try {
        // Delete test file
        await fs.unlink(testFile).catch((e) => console.error("Test file deletion failed:", e));

        // Close editors
        await commands.executeCommand("workbench.action.closeAllEditors");

        // Dispose event listeners
        for (const disposable of disposables) {
          try {
            if (disposable && typeof disposable.dispose === "function") {
              disposable.dispose();
            }
          } catch (e) {
            console.error("Resource disposal failed:", e);
          }
        }

        // Clear array
        disposables.length = 0;
      } catch (e) {
        console.error("Cleanup failed:", e);
      }
    });

    test("Linting", async () => {
      const fileUri = Uri.file(testFile);
      let diagnosticsReceived = false;
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
          diagnosticsReceived = true;
        }
      });

      disposables.push(disposable);

      try {
        // Open test file
        const doc = await workspace.openTextDocument(testFile);
        await window.showTextDocument(doc);
        await waitForEditorStabilization(1000);

        // Modify and save file to trigger linting
        const edit = new WorkspaceEdit();
        edit.insert(fileUri, new Position(0, 0), " ");
        await workspace.applyEdit(edit);
        await doc.save();

        // Show output channel
        await commands.executeCommand("textlint.showOutputChannel");

        // Wait for diagnostics
        const received = await waitForCondition(() => diagnosticsReceived);
        assert(received, "Should receive diagnostics within 10 seconds");

        // Expected diagnostics
        const expectedDiagnostics = [
          {
            code: "common-misspellings",
            message: "This is a commonly misspelled word. Correct it to you (common-misspellings)",
            range: {
              start: { line: 0, character: 1 },
              end: { line: 0, character: 1 },
            },
            severity: DiagnosticSeverity.Error,
            source: "textlint",
          },
          {
            code: "common-misspellings",
            message: "This is a commonly misspelled word. Correct it to you (common-misspellings)",
            range: {
              start: { line: 2, character: 0 },
              end: { line: 2, character: 0 },
            },
            severity: DiagnosticSeverity.Error,
            source: "textlint",
          },
          {
            code: "common-misspellings",
            message: "This is a commonly misspelled word. Correct it to you (common-misspellings)",
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

          assert.strictEqual(
            actual.severity,
            expected.severity,
            `Diagnostic[${i}] severity should match expected value`
          );

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
      } catch (e) {
        assert.fail(`Lint test failed: ${e}`);
      }
    });

    test("Autofix", async () => {
      // Fix completion flag and applied edits
      let appliedEdits: TextEdit[] = [];

      try {
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
      } catch (e) {
        assert.fail(`Autofix test failed: ${e}`);
      }
    });
  });
});

// References:
// https://github.com/Microsoft/vscode-mssql/blob/dev/test/initialization.test.ts
// https://github.com/HookyQR/VSCodeBeautify/blob/master/test/extension.test.js
// https://github.com/Microsoft/vscode-docs/blob/master/docs/extensionAPI/vscode-api-commands.md
// https://github.com/Microsoft/vscode-docs/blob/master/docs/extensionAPI/vscode-api.md
