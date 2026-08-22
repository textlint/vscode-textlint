import {
  createConnection,
  CodeActionKind,
  ConfigurationRequest,
  DiagnosticSeverity,
  DidChangeConfigurationNotification,
  TextDocuments,
  TextDocumentSyncKind,
  ErrorMessageTracker,
  Files,
  Position,
  ProposedFeatures,
  Range,
  TextDocumentEdit,
  TextEdit,
} from "vscode-languageserver/node";
import type { CodeAction, Diagnostic, WorkspaceFolder } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import { LogTraceNotification, Trace } from "vscode-jsonrpc";
import { URI, Utils as URIUtils } from "vscode-uri";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { inspect } from "node:util";
import minimatch from "minimatch";

import {
  NoConfigNotification,
  NoLibraryNotification,
  StatusNotification,
  ServerInitializationOptions,
  defaultServerInitializationOptions,
} from "../shared/types";

import { TextlintFixRepository } from "./autofix";
import type { AutoFix } from "./autofix";
import type { createLinter } from "textlint";
import type { TextlintMessage } from "@textlint/types";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const sourceFixAllTextlint = `${CodeActionKind.SourceFixAll}.textlint`;
let trace = Trace.Off;
documents.listen(connection);

type TextlintLinter = ReturnType<typeof createLinter>;

// Some supported textlint v13 releases omit scanFilePath despite the current type definition.
type WorkspaceLinter = {
  linter: {
    lintText: TextlintLinter["lintText"];
    scanFilePath?: TextlintLinter["scanFilePath"];
  };
  availableExtensions: string[];
};

type TextlintModule = Pick<typeof import("textlint"), "createLinter" | "loadTextlintrc">;

let settings = defaultServerInitializationOptions;
const lintersByWorkspaceFolderUri: Map<string, WorkspaceLinter> = new Map();
const fixRepositoriesByDocumentUri: Map<string, TextlintFixRepository> = new Map();

connection.onInitialize(() => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix, sourceFixAllTextlint],
      },
      workspace: {
        workspaceFolders: {
          supported: true,
          changeNotifications: true,
        },
      },
    },
  };
});

connection.onInitialized(async () => {
  await connection.client.register(DidChangeConfigurationNotification.type);
  await updateSettings();
  const folders = await connection.workspace.getWorkspaceFolders();
  await configureEngine(folders);
  connection.workspace.onDidChangeWorkspaceFolders(async (event) => {
    for (const folder of event.removed) {
      lintersByWorkspaceFolderUri.delete(folder.uri);
    }
    await reConfigure();
  });
});

async function configureEngine(folders: WorkspaceFolder[] | null) {
  await Promise.all(
    (folders ?? []).map(async (folder) => {
      TRACE(`configureEngine ${folder.uri}`);
      const root = URI.parse(folder.uri).fsPath;
      try {
        const configFile = lookupConfig(root);
        const ignoreFile = lookupIgnore(root);

        const mod = await resolveModule(root);
        const descriptor = await mod.loadTextlintrc({
          configFilePath: configFile,
        });
        const linter = mod.createLinter({
          descriptor,
          ignoreFilePath: ignoreFile,
        });
        lintersByWorkspaceFolderUri.set(folder.uri, {
          linter,
          availableExtensions: descriptor.availableExtensions,
        });
      } catch (error) {
        TRACE("failed to configureEngine", error);
      }
    }),
  );
}

function lookupConfig(root: string): string | undefined {
  const roots = [
    candidates(root),
    () => {
      return settings.configPath !== null && fs.existsSync(settings.configPath)
        ? [settings.configPath]
        : [];
    },
    candidates(os.homedir()),
  ];
  for (const fn of roots) {
    const files = fn();
    if (files.length > 0) {
      return files[0];
    }
  }
  void connection.sendNotification(NoConfigNotification.type, {
    workspaceFolder: root,
  });
  return undefined;
}

function lookupIgnore(root: string): string | undefined {
  const ignorePath = settings.ignorePath ?? path.resolve(root, ".textlintignore");
  if (fs.existsSync(ignorePath)) {
    return ignorePath;
  }
  return undefined;
}

async function resolveModule(root: string) {
  try {
    TRACE(`Module textlint resolve from ${root}`);
    const modulePath = await Files.resolveModulePath(
      root,
      "textlint",
      settings.nodePath ?? "",
      TRACE,
    );
    TRACE(`Module textlint got resolved to ${modulePath}`);
    return loadModule(modulePath);
  } catch (e) {
    void connection.sendNotification(NoLibraryNotification.type, {
      workspaceFolder: root,
    });
    throw e;
  }
}

const runtimeRequire = createRequire(import.meta.url);

function loadModule(moduleName: string): TextlintModule {
  const module: unknown = runtimeRequire(moduleName);
  if (!isTextlintModule(module)) {
    throw new TypeError(`${moduleName} does not provide the textlint API`);
  }
  return module;
}

function isTextlintModule(module: unknown): module is TextlintModule {
  return (
    typeof module === "object" &&
    module !== null &&
    "createLinter" in module &&
    typeof module.createLinter === "function" &&
    "loadTextlintrc" in module &&
    typeof module.loadTextlintrc === "function"
  );
}

async function reConfigure() {
  TRACE(`reConfigure`);
  await configureEngine(await connection.workspace.getWorkspaceFolders());
  const docs: TextDocument[] = [];
  for (const uri of fixRepositoriesByDocumentUri.keys()) {
    TRACE(`reConfigure:push ${uri}`);
    void connection.sendDiagnostics({ uri, diagnostics: [] });
    const doc = documents.get(uri);
    if (doc) {
      docs.push(doc);
    }
  }
  return validateMany(docs);
}

async function updateSettings(): Promise<void> {
  const configurations = await connection.sendRequest<ServerInitializationOptions[]>(
    ConfigurationRequest.method,
    { items: [{ section: "textlint" }] },
  );
  settings = configurations[0] ?? defaultServerInitializationOptions;
  trace = Trace.fromString(settings.trace);
}

connection.onDidChangeConfiguration(async () => {
  await updateSettings();
  TRACE("onDidChangeConfiguration", settings);
  await reConfigure();
});

connection.onDidChangeWatchedFiles(async () => {
  TRACE("onDidChangeWatchedFiles");
  await reConfigure();
});

documents.onDidChangeContent((event) => {
  const uri = event.document.uri;
  TRACE(`onDidChangeContent ${uri}`, settings.run);
  if (settings.run === "onType") {
    void validateSingle(event.document);
  }
});
documents.onDidSave((event) => {
  const uri = event.document.uri;
  TRACE(`onDidSave ${uri}`, settings.run);
  if (settings.run === "onSave") {
    void validateSingle(event.document);
  }
});

documents.onDidOpen((event) => {
  const uri = event.document.uri;
  TRACE(`onDidOpen ${uri}`);
  if (uri.startsWith("file:") && !fixRepositoriesByDocumentUri.has(uri)) {
    fixRepositoriesByDocumentUri.set(uri, new TextlintFixRepository());
    void validateSingle(event.document);
  }
});

function clearDiagnostics(uri: string) {
  TRACE(`clearDiagnostics ${uri}`);
  if (uri.startsWith("file:")) {
    fixRepositoriesByDocumentUri.delete(uri);
    void connection.sendDiagnostics({ uri, diagnostics: [] });
  }
}
documents.onDidClose((event) => {
  const uri = event.document.uri;
  TRACE(`onDidClose ${uri}`);
  clearDiagnostics(uri);
});

function validateSingle(textDocument: TextDocument) {
  return withValidationProgress(async () => {
    try {
      await validate(textDocument);
      sendOK();
    } catch (error) {
      sendError(error);
    }
  });
}

function validateMany(textDocuments: TextDocument[]) {
  return withValidationProgress(async () => {
    const tracker = new ErrorMessageTracker();
    await Promise.all(
      textDocuments.map(async (document) => {
        try {
          await validate(document);
        } catch (error) {
          tracker.add(errorMessage(error));
        }
      }),
    );
    tracker.sendErrors(connection);
  });
}

async function withValidationProgress<T>(task: () => Promise<T>): Promise<T> {
  const progress = await connection.window.createWorkDoneProgress();
  progress.begin("textlint", undefined, "Linting");
  try {
    return await task();
  } finally {
    progress.done();
  }
}

function candidates(root: string) {
  return () => fs.globSync(`${root}/.textlintr{c.js,c.yaml,c.yml,c,c.json}`);
}

function isTarget(rootUri: string, fileUri: URI): boolean {
  const relativePath = path.posix.relative(URI.parse(rootUri).path, fileUri.path);
  return (
    settings.targetPath === "" ||
    minimatch(relativePath, settings.targetPath, {
      matchBase: true,
    })
  );
}

function startsWith(target: string, prefix: string): boolean {
  if (target.length < prefix.length) {
    return false;
  }
  const tElements = target.split("/");
  const pElements = prefix.split("/");
  for (let i = 0; i < pElements.length; i++) {
    if (pElements[i] !== tElements[i]) {
      return false;
    }
  }

  return true;
}

function lookupEngine(doc: TextDocument): [string, WorkspaceLinter | undefined] {
  TRACE(`lookupEngine ${doc.uri}`);
  for (const ent of lintersByWorkspaceFolderUri.entries()) {
    if (startsWith(doc.uri, ent[0])) {
      TRACE(`lookupEngine ${doc.uri} => ${ent[0]}`);
      return ent;
    }
  }
  TRACE(`lookupEngine ${doc.uri} not found`);
  return ["", undefined];
}

async function validate(doc: TextDocument): Promise<void> {
  const documentUri = doc.uri;
  const version = doc.version;
  const text = doc.getText();
  TRACE(`validate ${documentUri}`);
  if (!documentUri.startsWith("file:")) {
    TRACE("validation skipped...");
    return;
  }

  const repo = fixRepositoriesByDocumentUri.get(documentUri);
  if (!repo) {
    return;
  }

  const [folder, engine] = lookupEngine(doc);
  const uri = URI.parse(documentUri);
  const ext = URIUtils.extname(uri);
  if (!engine || !engine.availableExtensions.includes(ext) || !isTarget(folder, uri)) {
    publishValidation(documentUri, version, repo, []);
    return;
  }

  try {
    // Some supported textlint v13 releases do not provide scanFilePath.
    const scanResult = await engine.linter.scanFilePath?.(uri.fsPath);
    if (scanResult?.status === "ignored") {
      TRACE(`ignore ${documentUri}`);
      publishValidation(documentUri, version, repo, []);
      return;
    }
    if (
      scanResult?.status === "error" &&
      scanResult.errors.some((error) => error.type !== "ScanFilePathNoExistFilePathError")
    ) {
      throw new Error(scanResult.errors.map((error) => error.type).join(", "));
    }

    const result = await engine.linter.lintText(text, uri.fsPath);
    TRACE("result", result);
    publishValidation(
      documentUri,
      version,
      repo,
      result.messages.map((message) => toDiagnostic(message)),
    );
  } catch (error) {
    if (publishValidation(documentUri, version, repo, [])) {
      throw error;
    }
  }
}

function publishValidation(
  uri: string,
  version: number,
  repo: TextlintFixRepository,
  entries: [TextlintMessage, Diagnostic][],
) {
  if (documents.get(uri)?.version !== version || fixRepositoriesByDocumentUri.get(uri) !== repo) {
    TRACE(`discard stale validation ${uri}`, version);
    return false;
  }

  repo.replace(version, entries);
  TRACE(`sendDiagnostics ${uri}`);
  void connection.sendDiagnostics({
    uri,
    diagnostics: entries.map(([, diagnostic]) => diagnostic),
  });
  return true;
}

function toDiagnosticSeverity(severity: TextlintMessage["severity"]): DiagnosticSeverity {
  switch (severity) {
    case 2:
      return DiagnosticSeverity.Error;
    case 1:
      return DiagnosticSeverity.Warning;
    case 0:
      return DiagnosticSeverity.Information;
    case 3:
      return DiagnosticSeverity.Information;
  }
  return DiagnosticSeverity.Information;
}

function toDiagnostic(message: TextlintMessage): [TextlintMessage, Diagnostic] {
  const startPosition = Position.create(
    Math.max(0, message.loc.start.line - 1),
    Math.max(0, message.loc.start.column - 1),
  );
  let offset = 0;
  if (message.message.includes("->")) {
    offset = message.message.indexOf(" ->");
  }
  const quoteIndex = message.message.indexOf(`"`);
  if (quoteIndex >= 0) {
    offset = Math.max(0, message.message.indexOf(`"`, quoteIndex + 1) - quoteIndex - 1);
  }
  const endPosition = Position.create(
    Math.max(0, message.loc.start.line - 1),
    Math.max(0, message.loc.start.column - 1) + offset,
  );
  const diag: Diagnostic = {
    message: message.message,
    severity: toDiagnosticSeverity(message.severity),
    source: "textlint",
    range: Range.create(startPosition, endPosition),
    code: message.ruleId,
  };
  return [message, diag];
}

connection.onCodeAction(async (params) => {
  TRACE("onCodeAction", params);
  const uri = params.textDocument.uri;
  const repo = fixRepositoriesByDocumentUri.get(uri);
  const doc = documents.get(uri);
  if (!repo || !doc) {
    return [];
  }

  const version = doc.version;
  const only = params.context.only;
  const quickFixRequested =
    only === undefined ||
    only.some((kind) => kind === CodeActionKind.Empty || kind === CodeActionKind.QuickFix);
  const sourceFixAllRequested =
    only?.some((kind) =>
      [
        CodeActionKind.Empty,
        CodeActionKind.Source,
        CodeActionKind.SourceFixAll,
        sourceFixAllTextlint,
      ].includes(kind),
    ) ?? false;
  if (!quickFixRequested && !sourceFixAllRequested) {
    return [];
  }

  if (sourceFixAllRequested || repo.version !== version) {
    try {
      await validate(doc);
    } catch (error) {
      sendError(error);
      return [];
    }
  }
  if (
    documents.get(uri)?.version !== version ||
    fixRepositoriesByDocumentUri.get(uri) !== repo ||
    repo.version !== version ||
    repo.isEmpty()
  ) {
    return [];
  }

  const toWorkspaceEdit = (fixes: AutoFix[]) => ({
    documentChanges: [
      TextDocumentEdit.create(
        { uri, version: repo.version },
        fixes.map((fix) => toTextEdit(doc, fix)),
      ),
    ],
  });
  const requestedFixes = quickFixRequested ? repo.findMatching(params.context.diagnostics) : [];
  const quickFixes: CodeAction[] = requestedFixes.map((fix) => ({
    title: `Fix this ${fix.ruleId} problem`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [fix.diagnostic],
    edit: toWorkspaceEdit([fix]),
  }));
  const sameRuleFixes: CodeAction[] = [...new Set(requestedFixes.map((fix) => fix.ruleId))].flatMap(
    (ruleId) => {
      const fixes = repo.separatedValues((fix) => fix.ruleId === ruleId);
      return fixes.length > 1
        ? [
            {
              title: `Fix all ${ruleId} problems`,
              kind: CodeActionKind.QuickFix,
              diagnostics: fixes.map((fix) => fix.diagnostic),
              edit: toWorkspaceEdit(fixes),
            },
          ]
        : [];
    },
  );
  const sourceFixes: CodeAction[] = sourceFixAllRequested
    ? [
        {
          title: `Fix all auto-fixable textlint problems`,
          kind: sourceFixAllTextlint,
          edit: toWorkspaceEdit(repo.separatedValues()),
        },
      ]
    : [];
  return [...quickFixes, ...sameRuleFixes, ...sourceFixes];
});

function toTextEdit(textDocument: TextDocument, af: AutoFix): TextEdit {
  return TextEdit.replace(
    Range.create(
      textDocument.positionAt(af.fix.range[0]),
      textDocument.positionAt(af.fix.range[1]),
    ),
    af.fix.text,
  );
}

function sendOK() {
  TRACE("sendOK");
  void connection.sendNotification(StatusNotification.type, {
    status: StatusNotification.Status.OK,
  });
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

function sendError(error: unknown) {
  TRACE("sendError", error);
  void connection.sendNotification(StatusNotification.type, {
    status: StatusNotification.Status.ERROR,
    message: errorMessage(error),
    cause: errorStack(error),
  });
}

function toVerbose(data?: unknown): string {
  if (data === undefined) {
    return "";
  }
  return typeof data === "string" ? data : inspect(data);
}

export function TRACE(message: string, data?: unknown) {
  switch (trace) {
    case Trace.Compact:
    case Trace.Messages:
      void connection.sendNotification(LogTraceNotification.type, {
        message,
      });
      break;
    case Trace.Verbose:
      void connection.sendNotification(LogTraceNotification.type, {
        message,
        verbose: toVerbose(data),
      });
      break;
    case Trace.Off:
      // do nothing.
      break;
    default:
      break;
  }
}

connection.listen();
