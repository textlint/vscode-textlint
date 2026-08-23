import * as fs from "node:fs/promises";
import * as path from "node:path";
import { commands, extensions, Uri, workspace } from "vscode";
import type { Disposable, Extension } from "vscode";
import { NotificationType } from "vscode-jsonrpc";
import type { Diagnostic as LspDiagnostic } from "vscode-languageserver-types";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { ExtensionInternal } from "../../src/client/extension.ts";

const testPromises: Promise<void>[] = [];
const TEST_TIMEOUT = 90_000;
const DIAGNOSTICS_TIMEOUT = 10_000;

export const PublishDiagnosticsNotification = {
  type: new NotificationType<{ uri: string; diagnostics: LspDiagnostic[] }>(
    "textDocument/publishDiagnostics",
  ),
};

let extension: Extension<ExtensionInternal>;
let internals: ExtensionInternal;

export function checkedTest(
  name: string,
  function_: (context: TestContext) => Promise<void> | void,
): void {
  const testPromise = new Promise<void>((resolve, reject) => {
    void test(name, { timeout: TEST_TIMEOUT }, (context) => {
      const result = Promise.resolve().then(() => function_(context));
      void result.then(resolve, reject);
      return result;
    });
  });
  testPromises.push(testPromise);
}

export async function waitForEditorStabilization(timeMilliseconds = 1_000): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, timeMilliseconds);
  });
}

export async function waitForCondition(
  condition: () => boolean,
  maximumAttempts = 10,
  intervalMilliseconds = 1_000,
): Promise<boolean> {
  if (maximumAttempts <= 0) {
    return false;
  }
  if (condition()) {
    return true;
  }
  await waitForEditorStabilization(intervalMilliseconds);
  return waitForCondition(condition, maximumAttempts - 1, intervalMilliseconds);
}

export async function setupExtension(): Promise<{
  extension: Extension<ExtensionInternal>;
  internals: ExtensionInternal;
}> {
  const loadedExtension = extensions.getExtension<ExtensionInternal>("3w36zj6.textlint");
  if (!loadedExtension) {
    throw new Error("Extension not found");
  }
  if (!loadedExtension.isActive) {
    await loadedExtension.activate();
  }
  extension = loadedExtension;
  internals = loadedExtension.exports;
  return { extension, internals };
}

export function extensionInternals(): ExtensionInternal {
  return internals;
}

export function getWorkspaceRoot(): string {
  const folders = workspace.workspaceFolders;
  if (!folders) {
    throw new Error("Workspace folder not found");
  }
  return folders[0].uri.fsPath;
}

export function waitForDiagnostics(
  uri: Uri,
  accept: (diagnostics: readonly LspDiagnostic[]) => boolean = (diagnostics) =>
    diagnostics.length > 0,
): Promise<LspDiagnostic[]> {
  return new Promise((resolve, reject) => {
    const disposable = internals.client.onNotification(
      PublishDiagnosticsNotification.type,
      (params) => {
        if (params.uri === uri.toString() && accept(params.diagnostics)) {
          clearTimeout(timeout);
          disposable.dispose();
          resolve(params.diagnostics);
        }
      },
    );
    const timeout = setTimeout(() => {
      disposable.dispose();
      reject(new Error(`Diagnostics were not published for ${uri.toString()}`));
    }, DIAGNOSTICS_TIMEOUT);
  });
}

export async function setupServerFixture(
  context: TestContext,
  testFileName = "testtest2.txt",
): Promise<{ testFile: string; disposables: Disposable[] }> {
  await setupExtension();
  const rootPath = getWorkspaceRoot();
  const sourceFile = path.join(rootPath, "testtest.txt");
  const testFile = path.join(rootPath, testFileName);
  const disposables: Disposable[] = [];

  context.after(async () => {
    await commands.executeCommand("workbench.action.closeAllEditors");
    await fs.rm(testFile, { force: true });
    for (const disposable of disposables) {
      disposable.dispose();
    }
  });
  await fs.cp(sourceFile, testFile);
  return { testFile, disposables };
}

export async function testsDone(): Promise<void> {
  await Promise.all(testPromises);
  await waitForEditorStabilization(250);
}
