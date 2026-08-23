import { inspect } from "node:util";
import {
  ConfigurationRequest,
  createConnection,
  DidChangeConfigurationNotification,
  ErrorMessageTracker,
  LogTraceNotification,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  Trace,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  NoConfigNotification,
  NoLibraryNotification,
  StatusNotification,
  defaultServerInitializationOptions,
  type ServerInitializationOptions,
} from "../shared/types.ts";
import { sourceFixAllTextlint } from "./code-actions.ts";
import { createCodeActionHandler } from "./code-action-handler.ts";
import { createValidationService } from "./validation.ts";
import { createWorkspaceLinterService } from "./workspace-linters.ts";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let settings = defaultServerInitializationOptions;
let trace = Trace.Off;

documents.listen(connection);

export function TRACE(message: string, data?: unknown): void {
  switch (trace) {
    case Trace.Compact:
    case Trace.Messages:
      void connection.sendNotification(LogTraceNotification.type, { message });
      break;
    case Trace.Verbose:
      void connection.sendNotification(LogTraceNotification.type, {
        message,
        verbose: data === undefined ? "" : typeof data === "string" ? data : inspect(data),
      });
      break;
    case Trace.Off:
      break;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendOK(): void {
  TRACE("sendOK");
  void connection.sendNotification(StatusNotification.type, {
    status: StatusNotification.Status.OK,
  });
}

function sendError(error: unknown): void {
  TRACE("sendError", error);
  void connection.sendNotification(StatusNotification.type, {
    status: StatusNotification.Status.ERROR,
    message: errorMessage(error),
    cause: error instanceof Error ? error.stack : undefined,
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

const workspaceLinters = createWorkspaceLinterService({
  settings: () => settings,
  trace: TRACE,
  notifyNoConfig: (workspaceFolder) => {
    void connection.sendNotification(NoConfigNotification.type, { workspaceFolder });
  },
  notifyNoLibrary: (workspaceFolder) => {
    void connection.sendNotification(NoLibraryNotification.type, { workspaceFolder });
  },
});

const validation = createValidationService({
  document: (uri) => documents.get(uri),
  settings: () => settings,
  lookupLinter: workspaceLinters.lookup,
  trace: TRACE,
  sendDiagnostics: (uri, diagnostics) => {
    void connection.sendDiagnostics({ uri, diagnostics: [...diagnostics] });
  },
  withProgress: withValidationProgress,
  sendOk: sendOK,
  sendError,
  sendErrors: (errors) => {
    const tracker = new ErrorMessageTracker();
    for (const error of errors) {
      tracker.add(error);
    }
    tracker.sendErrors(connection);
  },
});

const codeActions = createCodeActionHandler({
  document: (uri) => documents.get(uri),
  repository: validation.repository,
  validate: validation.validate,
  trace: TRACE,
  sendError,
});

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    codeActionProvider: {
      codeActionKinds: ["quickfix", sourceFixAllTextlint],
    },
    workspace: {
      workspaceFolders: {
        supported: true,
        changeNotifications: true,
      },
    },
  },
}));

async function updateSettings(): Promise<void> {
  const configurations = await connection.sendRequest<ServerInitializationOptions[]>(
    ConfigurationRequest.method,
    { items: [{ section: "textlint" }] },
  );
  settings = configurations[0] ?? defaultServerInitializationOptions;
  trace = Trace.fromString(settings.trace);
}

async function reConfigure(): Promise<void> {
  TRACE("reConfigure");
  await workspaceLinters.configure(await connection.workspace.getWorkspaceFolders());
  await validation.validateMany(validation.prepareRevalidation());
}

connection.onInitialized(async () => {
  await connection.client.register(DidChangeConfigurationNotification.type);
  await updateSettings();
  await reConfigure();
  connection.workspace.onDidChangeWorkspaceFolders(async (event) => {
    for (const folder of event.removed) {
      workspaceLinters.remove(folder.uri);
    }
    await reConfigure();
  });
});

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
  TRACE(`onDidChangeContent ${event.document.uri}`, settings.run);
  if (settings.run === "onType") {
    void validation.validateSingle(event.document);
  }
});

documents.onDidSave((event) => {
  TRACE(`onDidSave ${event.document.uri}`, settings.run);
  if (settings.run === "onSave") {
    void validation.validateSingle(event.document);
  }
});

documents.onDidOpen((event) => {
  validation.open(event.document);
});
documents.onDidClose((event) => {
  validation.close(event.document);
});
connection.onCodeAction(codeActions.handle);
connection.listen();
