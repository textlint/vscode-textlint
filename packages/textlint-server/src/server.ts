import {
  createConnection,
  CodeAction,
  CodeActionKind,
  Command,
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
  MarkupKind,
  Files,
  TextDocuments,
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
import * as glob from "glob";
import * as minimatch from "minimatch";

import {
  NoConfigNotification,
  NoLibraryNotification,
  AllFixesRequest,
  StatusNotification,
  StartProgressNotification,
  StopProgressNotification,
} from "./types";

import { TextlintFixRepository, AutoFix } from "./autofix";
import type {
  AnyTxtNode,
  createLinter,
  TextlintKernelDescriptor,
  TextLintMessage,
  TxtDocumentNode,
  TxtParentNode,
} from "./textlint";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let trace: number;
let settings;
documents.listen(connection);

type TextlintLinter = {
  linter: ReturnType<createLinter>;
  availableExtensions: string[];
};

/**
 * A map for retrieving a TextlintKernelDescriptor by workspace folder URI.
 */
const descriptorRepo = new Map<string, TextlintKernelDescriptor>();
const linterRepo: Map<string /* workspaceFolder uri */, TextlintLinter> = new Map();
const fixRepo: Map<string /* uri */, TextlintFixRepository> = new Map();

connection.onInitialize(async (params) => {
  settings = params.initializationOptions;
  trace = Trace.fromString(settings.trace);
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      codeActionProvider: true,
      hoverProvider: true,
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

async function configureEngine(folders: WorkspaceFolder[]) {
  for (const folder of folders) {
    TRACE(`configureEngine ${folder.uri}`);
    const root = URI.parse(folder.uri).fsPath;
    try {
      const configFile = lookupConfig(root);
      const ignoreFile = lookupIgnore(root);

      const mod = await resolveModule(root);
      const hasLinterAPI = "createLinter" in mod && "loadTextlintrc" in mod;
      // textlint v13+
      if (hasLinterAPI) {
        const descriptor = await mod.loadTextlintrc({
          configFilePath: configFile,
        });
        descriptorRepo.set(folder.uri, descriptor);
        const linter = mod.createLinter({
          descriptor,
          ignoreFilePath: ignoreFile,
        });
        linterRepo.set(folder.uri, {
          linter,
          availableExtensions: descriptor.availableExtensions,
        });
      } else {
        // TODO: These APIs are deprecated. Remove this code in the future.
        // textlint v12 or older - deprecated engingles API
        const engine = new mod.TextLintEngine({
          configFile,
          ignoreFile,
        });
        // polyfill for textlint v12
        const linter: ReturnType<createLinter> = {
          lintText: (text, filePath) => {
            return engine.executeOnText(text, filePath);
          },
          lintFiles: (files) => {
            return engine.executeOnFiles(files);
          },
          fixFiles: (files) => {
            return engine.fixFiles(files);
          },
          fixText(text, filePath) {
            return engine.fixText(text, filePath);
          },
        };
        linterRepo.set(folder.uri, {
          linter,
          availableExtensions: engine.availableExtensions,
        });
      }
    } catch (e) {
      TRACE("failed to configureEngine", e);
    }
  }
}

function lookupConfig(root: string): string | undefined {
  const roots = [
    candidates(root),
    () => {
      return fs.existsSync(settings.configPath) ? [settings.configPath] : [];
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
    const path = await Files.resolveModulePath(root, "textlint", settings.nodePath, TRACE);
    TRACE(`Module textlint got resolved to ${path}`);
    return loadModule(path);
  } catch (e) {
    connection.sendNotification(NoLibraryNotification.type, {
      workspaceFolder: root,
    });
    throw e;
  }
}

declare const __webpack_require__: typeof require;
declare const __non_webpack_require__: typeof require;
function loadModule(moduleName: string) {
  const r = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
  try {
    return r(moduleName);
  } catch (err) {
    TRACE("load failed", err);
  }
  return undefined;
}

async function reConfigure() {
  TRACE(`reConfigure`);
  await configureEngine(await connection.workspace.getWorkspaceFolders());
  const docs = [];
  for (const uri of fixRepo.keys()) {
    TRACE(`reConfigure:push ${uri}`);
    connection.sendDiagnostics({ uri, diagnostics: [] });
    docs.push(documents.get(uri));
  }
  return validateMany(docs);
}

connection.onDidChangeConfiguration(async (change) => {
  const newone = change.settings.textlint;
  TRACE(`onDidChangeConfiguration ${JSON.stringify(newone)}`);
  settings = newone;
  trace = Trace.fromString(newone.trace);
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

function clearDiagnostics(uri) {
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
  sendStartProgress();
  return validate(textDocument)
    .then(sendOK, (error) => {
      sendError(error);
    })
    .then(sendStopProgress);
}

async function validateMany(textDocuments: TextDocument[]) {
  const tracker = new ErrorMessageTracker();
  sendStartProgress();
  for (const doc of textDocuments) {
    try {
      await validate(doc);
    } catch (err) {
      tracker.add(err.message);
    }
  }
  tracker.sendErrors(connection);
  sendStopProgress();
}

function candidates(root: string) {
  return () => glob.sync(`${root}/.textlintr{c.js,c.yaml,c.yml,c,c.json}`);
}

function isTarget(root: string, file: string): boolean {
  const relativePath = file.substring(root.length);
  return (
    settings.targetPath === "" ||
    minimatch(relativePath, settings.targetPath, {
      matchBase: true,
    })
  );
}

function startsWith(target, prefix: string): boolean {
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

function lookupEngine(doc: TextDocument): [string, TextlintLinter] {
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

/**
 * Lookup the descriptor for a TextDocument.
 * Returns the descriptor that best matches the given TextDocument by using the longest prefix match.
 */
function lookupDescriptor(doc: TextDocument): [string, TextlintKernelDescriptor | undefined] {
  const uri = doc.uri;
  TRACE(`lookupDescriptor ${uri}`);
  let bestKey = "";
  let bestDescriptor: TextlintKernelDescriptor | undefined = undefined;
  for (const [key, desc] of descriptorRepo.entries()) {
    if (startsWith(uri, key) && key.length > bestKey.length) {
      bestKey = key;
      bestDescriptor = desc;
    }
  }
  if (bestDescriptor) {
    TRACE(`lookupDescriptor ${uri} => ${bestKey}`);
    return [bestKey, bestDescriptor];
  }
  TRACE(`lookupDescriptor ${uri} not found`);
  return ["", undefined];
}

async function validate(doc: TextDocument) {
  TRACE(`validate ${doc.uri}`);
  const uri = URI.parse(doc.uri);
  if (doc.uri.startsWith("file:") === false) {
    TRACE("validation skipped...");
    return;
  }

  const repo = fixRepo.get(doc.uri);
  if (repo) {
    const [folder, engine] = lookupEngine(doc);
    const ext = URIUtils.extname(uri);
    if (engine && -1 < engine.availableExtensions.findIndex((s) => s === ext) && isTarget(folder, uri.fsPath)) {
      repo.clear();
      try {
        if (engine.linter.scanFilePath) {
          const result = await engine.linter.scanFilePath(uri.fsPath);
          if (result.status !== "ok") {
            TRACE(`ignore ${doc.uri}`);
            return;
          }
        }
        const results = [await engine.linter.lintText(doc.getText(), uri.fsPath)];
        TRACE("results", results);
        for (const result of results) {
          const diagnostics = result.messages.map(toDiagnostic).map(([msg, diag]) => {
            repo.register(doc, diag, msg);
            return diag;
          });
          TRACE(`sendDiagnostics ${doc.uri}`);
          connection.sendDiagnostics({ uri: doc.uri, diagnostics });
        }
      } catch (e) {
        sendError(e);
      }
    }
  }
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

function toDiagnostic(message: TextLintMessage): [TextLintMessage, Diagnostic] {
  const txt = message.ruleId ? `${message.message} (${message.ruleId})` : message.message;
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
    message: txt,
    severity: toDiagnosticSeverity(message.severity),
    source: "textlint",
    range: Range.create(pos_start, pos_end),
    code: message.ruleId,
  };
  return [message, diag];
}

connection.onCodeAction((params) => {
  TRACE("onCodeAction", params);
  const result: CodeAction[] = [];
  const uri = params.textDocument.uri;
  const repo = fixRepo.get(uri);
  if (repo && repo.isEmpty() === false) {
    const doc = documents.get(uri);
    const toAction = (title, edits) => {
      const cmd = Command.create(title, "textlint.applyTextEdits", uri, repo.version, edits);
      return CodeAction.create(title, cmd, CodeActionKind.QuickFix);
    };
    const toTE = (af) => toTextEdit(doc, af);

    repo.find(params.context.diagnostics).forEach((af) => {
      result.push(toAction(`Fix this ${af.ruleId} problem`, [toTE(af)]));
      const same = repo.separatedValues((v) => v.ruleId === af.ruleId);
      if (0 < same.length) {
        result.push(toAction(`Fix all ${af.ruleId} problems`, same.map(toTE)));
      }
    });
    const all = repo.separatedValues();
    if (0 < all.length) {
      result.push(toAction(`Fix all auto-fixable problems`, all.map(toTE)));
    }
  }
  return result;
});

function toTextEdit(textDocument: TextDocument, af: AutoFix): TextEdit {
  return TextEdit.replace(
    Range.create(textDocument.positionAt(af.fix.range[0]), textDocument.positionAt(af.fix.range[1])),
    af.fix.text || ""
  );
}

connection.onRequest(AllFixesRequest.type, (params: AllFixesRequest.Params) => {
  const uri = params.textDocument.uri;
  TRACE(`AllFixesRequest ${uri}`);
  const textDocument = documents.get(uri);
  const repo = fixRepo.get(uri);
  if (repo && repo.isEmpty() === false) {
    return {
      documentVersion: repo.version,
      edits: repo.separatedValues().map((af) => toTextEdit(textDocument, af)),
    };
  }
});

let inProgress = 0;
function sendStartProgress() {
  TRACE(`sendStartProgress ${inProgress}`);
  if (inProgress < 1) {
    inProgress = 0;
    connection.sendNotification(StartProgressNotification.type);
  }
  inProgress++;
}

function sendStopProgress() {
  TRACE(`sendStopProgress ${inProgress}`);
  if (--inProgress < 1) {
    inProgress = 0;
    connection.sendNotification(StopProgressNotification.type);
  }
}

function sendOK() {
  TRACE("sendOK");
  connection.sendNotification(StatusNotification.type, {
    status: StatusNotification.Status.OK,
  });
}
function sendError(error) {
  TRACE(`sendError ${error}`);
  const msg = error.message ? error.message : error;
  connection.sendNotification(StatusNotification.type, {
    status: StatusNotification.Status.ERROR,
    message: <string>msg,
    cause: error.stack,
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

/**
 * Hover handler that returns the textlint AST node type at the hovered position.
 */
connection.onHover(async (params) => {
  try {
    const uri = params.textDocument.uri;
    const document = documents.get(uri);
    if (!document) {
      return null;
    }

    const position = params.position;
    const charOffset = document.offsetAt(position);

    const [, descriptor] = lookupDescriptor(document);
    if (!descriptor) {
      return null;
    }

    const ext = URIUtils.extname(URI.parse(document.uri));
    const pluginDescriptor = descriptor.findPluginDescriptorWithExt(ext);
    if (!pluginDescriptor) {
      return null;
    }

    const textProcessor = pluginDescriptor.processor.processor(ext);
    const preProcessResult = await textProcessor.preProcess(document.getText(), document.uri);

    const isAstWithAst = (x: unknown): x is { ast: TxtDocumentNode } => {
      return !!x && typeof x === "object" && "ast" in x;
    };

    const rootAst: TxtDocumentNode = isAstWithAst(preProcessResult)
      ? preProcessResult.ast
      : (preProcessResult as TxtDocumentNode);

    let bestNode: AnyTxtNode | null = null;
    let ancestorTypes: string[] = [];

    const nodeContainsOffset = (node: AnyTxtNode | undefined, off: number): boolean => {
      if (!node) {
        return false;
      }
      if (node.range && node.range.length === 2) {
        return off >= node.range[0] && off <= node.range[1];
      }
      if (node.loc && node.loc.start) {
        const startLine = Math.max(0, node.loc.start.line - 1);
        const startCol = Math.max(0, node.loc.start.column);
        let endLine = startLine;
        let endCol = startCol;
        if (node.loc.end) {
          endLine = Math.max(0, node.loc.end.line - 1);
          endCol = Math.max(0, node.loc.end.column);
        }
        const startOffset = document.offsetAt(Position.create(startLine, startCol));
        const endOffset = document.offsetAt(Position.create(endLine, endCol));
        return off >= startOffset && off <= endOffset;
      }
      return false;
    };

    const isParentNode = (n: AnyTxtNode): n is TxtParentNode => {
      return "children" in n && Array.isArray((n as unknown as TxtParentNode).children);
    };

    const traverseNode = (node: AnyTxtNode, ancestors: string[]): void => {
      if (!node) {
        return;
      }
      if (nodeContainsOffset(node, charOffset)) {
        if (!bestNode) {
          bestNode = node;
          ancestorTypes = ancestors.slice();
        } else if (node.range && bestNode.range) {
          const nodeLen = node.range[1] - node.range[0];
          const bestLen = bestNode.range[1] - bestNode.range[0];
          if (nodeLen <= bestLen) {
            bestNode = node;
            ancestorTypes = ancestors.slice();
          }
        } else {
          bestNode = node;
          ancestorTypes = ancestors.slice();
        }
      }
      if (isParentNode(node)) {
        for (const childNode of node.children) {
          traverseNode(childNode, ancestors.concat(node.type));
        }
      }
    };

    traverseNode(rootAst, []);
    if (!bestNode) {
      return null;
    }

    const parentChain = ancestorTypes.concat(bestNode.type);
    const quotedParentChain = parentChain.length ? parentChain.map((t) => `\`${t}\``).join(" → ") : "(no parents)";
    const hoverContents = {
      kind: MarkupKind.Markdown,
      value: `textlint AST node: **\`${bestNode.type}\`** (${quotedParentChain})`,
    };

    let hoverRange: Range | undefined = undefined;
    if (bestNode.range && bestNode.range.length === 2) {
      hoverRange = Range.create(document.positionAt(bestNode.range[0]), document.positionAt(bestNode.range[1]));
    } else if (bestNode.loc && bestNode.loc.start) {
      const start = Position.create(Math.max(0, bestNode.loc.start.line - 1), Math.max(0, bestNode.loc.start.column));
      const end = bestNode.loc.end
        ? Position.create(Math.max(0, bestNode.loc.end.line - 1), Math.max(0, bestNode.loc.end.column))
        : start;
      hoverRange = Range.create(start, end);
    }

    return {
      contents: hoverContents,
      range: hoverRange,
    };
  } catch (e) {
    TRACE(`onHover failed: ${String(e)}`);
    return null;
  }
});
connection.listen();
