import {
  createConnection,
  CodeAction,
  CodeActionKind,
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
  Files,
  TextDocuments,
  TextDocumentEdit,
  TextEdit,
  TextDocumentSyncKind,
  ErrorMessageTracker,
  ProposedFeatures,
  WorkspaceFolder,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import { Trace, LogTraceNotification } from "vscode-jsonrpc";
import { URI, Utils as URIUtils } from "vscode-uri";

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "node:module";
import minimatch from "minimatch";

import {
  NoConfigNotification,
  NoLibraryNotification,
  StatusNotification,
  ServerInitializationOptions,
  defaultServerInitializationOptions,
} from "../shared/types";

import { TextlintFixRepository, AutoFix } from "./autofix";
import type { createLinter } from "textlint";
import type { TextlintMessage } from "@textlint/types";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const sourceFixAllTextlint = `${CodeActionKind.SourceFixAll}.textlint`;
let trace: number;
documents.listen(connection);

type WorkspaceLinter = {
  linter: ReturnType<typeof createLinter>;
  availableExtensions: string[];
};

let settings: ServerInitializationOptions;
const linterRepo: Map<string /* workspaceFolder uri */, WorkspaceLinter> = new Map();
const fixRepo: Map<string /* uri */, TextlintFixRepository> = new Map();

connection.onInitialize(async (params) => {
  settings = params.initializationOptions ?? defaultServerInitializationOptions;
  trace = Trace.fromString(settings.trace);
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
  const folders = await connection.workspace.getWorkspaceFolders();
  await configureEngine(folders);
  connection.workspace.onDidChangeWorkspaceFolders(async (event) => {
    for (const folder of event.removed) {
      linterRepo.delete(folder.uri);
    }
    await reConfigure();
  });
});

async function configureEngine(folders: WorkspaceFolder[] | null) {
  for (const folder of folders ?? []) {
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
      linterRepo.set(folder.uri, {
        linter,
        availableExtensions: descriptor.availableExtensions,
      });
    } catch (e) {
      TRACE("failed to configureEngine", e);
    }
  }
}

function lookupConfig(root: string): string | undefined {
  const roots = [
    candidates(root),
    () => {
      return settings.configPath && fs.existsSync(settings.configPath) ? [settings.configPath] : [];
    },
    candidates(os.homedir()),
  ];
  for (const fn of roots) {
    const files = fn();
    if (0 < files.length) {
      return files[0];
    }
  }
  connection.sendNotification(NoConfigNotification.type, {
    workspaceFolder: root,
  });
}

function lookupIgnore(root: string): string | undefined {
  const ignorePath = settings.ignorePath || path.resolve(root, ".textlintignore");
  if (fs.existsSync(ignorePath)) {
    return ignorePath;
  }
}

async function resolveModule(root: string) {
  try {
    TRACE(`Module textlint resolve from ${root}`);
    const path = await Files.resolveModulePath(root, "textlint", settings.nodePath ?? "", TRACE);
    TRACE(`Module textlint got resolved to ${path}`);
    return loadModule(path);
  } catch (e) {
    connection.sendNotification(NoLibraryNotification.type, {
      workspaceFolder: root,
    });
    throw e;
  }
}

const runtimeRequire = createRequire(import.meta.url);

function loadModule(moduleName: string) {
  try {
    return runtimeRequire(moduleName);
  } catch (err) {
    TRACE("load failed", err);
  }
  return undefined;
}

async function reConfigure() {
  TRACE(`reConfigure`);
  await configureEngine(await connection.workspace.getWorkspaceFolders());
  const docs: TextDocument[] = [];
  for (const uri of fixRepo.keys()) {
    TRACE(`reConfigure:push ${uri}`);
    connection.sendDiagnostics({ uri, diagnostics: [] });
    const doc = documents.get(uri);
    if (doc) {
      docs.push(doc);
    }
  }
  return validateMany(docs);
}

connection.onDidChangeConfiguration(async (change) => {
  const newSettings: ServerInitializationOptions = change.settings.textlint ?? defaultServerInitializationOptions;
  TRACE(`onDidChangeConfiguration ${JSON.stringify(newSettings)}`);
  settings = newSettings;
  trace = Trace.fromString(settings.trace);
  await reConfigure();
});

connection.onDidChangeWatchedFiles(async () => {
  TRACE("onDidChangeWatchedFiles");
  await reConfigure();
});

documents.onDidChangeContent(async (event) => {
  const uri = event.document.uri;
  TRACE(`onDidChangeContent ${uri}`, settings.run);
  if (settings.run === "onType") {
    return validateSingle(event.document);
  }
});
documents.onDidSave(async (event) => {
  const uri = event.document.uri;
  TRACE(`onDidSave ${uri}`, settings.run);
  if (settings.run === "onSave") {
    return validateSingle(event.document);
  }
});

documents.onDidOpen(async (event) => {
  const uri = event.document.uri;
  TRACE(`onDidOpen ${uri}`);
  if (uri.startsWith("file:") && fixRepo.has(uri) === false) {
    fixRepo.set(uri, new TextlintFixRepository());
    return validateSingle(event.document);
  }
});

function clearDiagnostics(uri: string) {
  TRACE(`clearDiagnostics ${uri}`);
  if (uri.startsWith("file:")) {
    fixRepo.delete(uri);
    connection.sendDiagnostics({ uri, diagnostics: [] });
  }
}
documents.onDidClose((event) => {
  const uri = event.document.uri;
  TRACE(`onDidClose ${uri}`);
  clearDiagnostics(uri);
});

async function validateSingle(textDocument: TextDocument) {
  return withValidationProgress(async () => {
    try {
      await validate(textDocument);
      sendOK();
    } catch (error) {
      sendError(error);
    }
  });
}

async function validateMany(textDocuments: TextDocument[]) {
  return withValidationProgress(async () => {
    const tracker = new ErrorMessageTracker();
    for (const doc of textDocuments) {
      try {
        await validate(doc);
      } catch (err) {
        tracker.add(errorMessage(err));
      }
    }
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
  for (const ent of linterRepo.entries()) {
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
  if (documentUri.startsWith("file:") === false) {
    TRACE("validation skipped...");
    return;
  }

  const repo = fixRepo.get(documentUri);
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
      result.messages.map((message) => toDiagnostic(message))
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
  entries: [TextlintMessage, Diagnostic][]
) {
  if (documents.get(uri)?.version !== version || fixRepo.get(uri) !== repo) {
    TRACE(`discard stale validation ${uri}`, version);
    return false;
  }

  repo.replace(version, entries);
  TRACE(`sendDiagnostics ${uri}`);
  connection.sendDiagnostics({ uri, diagnostics: entries.map(([, diagnostic]) => diagnostic) });
  return true;
}

function toDiagnosticSeverity(severity?: number): DiagnosticSeverity {
  switch (severity) {
    case 2:
      return DiagnosticSeverity.Error;
    case 1:
      return DiagnosticSeverity.Warning;
    case 0:
      return DiagnosticSeverity.Information;
  }
  return DiagnosticSeverity.Information;
}

function toDiagnostic(message: TextlintMessage): [TextlintMessage, Diagnostic] {
  const pos_start = Position.create(Math.max(0, message.line - 1), Math.max(0, message.column - 1));
  let offset = 0;
  if (message.message.indexOf("->") >= 0) {
    offset = message.message.indexOf(" ->");
  }
  const quoteIndex = message.message.indexOf(`"`);
  if (quoteIndex >= 0) {
    offset = Math.max(0, message.message.indexOf(`"`, quoteIndex + 1) - quoteIndex - 1);
  }
  const pos_end = Position.create(Math.max(0, message.line - 1), Math.max(0, message.column - 1) + offset);
  const diag: Diagnostic = {
    message: message.message,
    severity: toDiagnosticSeverity(message.severity),
    source: "textlint",
    range: Range.create(pos_start, pos_end),
    code: message.ruleId,
  };
  return [message, diag];
}

connection.onCodeAction(async (params) => {
  TRACE("onCodeAction", params);
  const uri = params.textDocument.uri;
  const repo = fixRepo.get(uri);
  const doc = documents.get(uri);
  if (!repo || !doc) {
    return [];
  }

  const version = doc.version;
  const only = params.context.only;
  const quickFixRequested =
    only === undefined || only.some((kind) => kind === CodeActionKind.Empty || kind === CodeActionKind.QuickFix);
  const sourceFixAllRequested =
    only?.some((kind) =>
      [CodeActionKind.Empty, CodeActionKind.Source, CodeActionKind.SourceFixAll, sourceFixAllTextlint].includes(kind)
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
    fixRepo.get(uri) !== repo ||
    repo.version !== version ||
    repo.isEmpty()
  ) {
    return [];
  }

  const toWorkspaceEdit = (fixes: AutoFix[]) => ({
    documentChanges: [
      TextDocumentEdit.create(
        { uri, version: repo.version },
        fixes.map((fix) => toTextEdit(doc, fix))
      ),
    ],
  });
  const requestedFixes = quickFixRequested ? repo.find(params.context.diagnostics) : [];
  const quickFixes: CodeAction[] = requestedFixes.map((fix) => ({
    title: `Fix this ${fix.ruleId} problem`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [fix.diagnostic],
    edit: toWorkspaceEdit([fix]),
  }));
  const sameRuleFixes: CodeAction[] = [...new Set(requestedFixes.map((fix) => fix.ruleId))].flatMap((ruleId) => {
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
  });
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
    Range.create(textDocument.positionAt(af.fix.range[0]), textDocument.positionAt(af.fix.range[1])),
    af.fix.text
  );
}

function sendOK() {
  TRACE("sendOK");
  connection.sendNotification(StatusNotification.type, {
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
  TRACE(`sendError ${error}`);
  connection.sendNotification(StatusNotification.type, {
    status: StatusNotification.Status.ERROR,
    message: errorMessage(error),
    cause: errorStack(error),
  });
}

function toVerbose(data?: unknown): string {
  let verbose = "";
  if (data) {
    verbose = typeof data === "string" ? data : JSON.stringify(data, Object.getOwnPropertyNames(data));
  }
  return verbose;
}

export function TRACE(message: string, data?: unknown) {
  switch (trace) {
    case Trace.Messages:
      connection.sendNotification(LogTraceNotification.type, {
        message,
      });
      break;
    case Trace.Verbose:
      connection.sendNotification(LogTraceNotification.type, {
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
