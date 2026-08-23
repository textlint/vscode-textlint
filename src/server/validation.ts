import { URI, Utils as URIUtils } from "vscode-uri";
import type { Diagnostic } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { ServerInitializationOptions } from "../shared/types.ts";
import { toDiagnostic, type DiagnosticEntry } from "./diagnostics.ts";
import { emptyFixRepository, replaceFixRepository, type FixRepository } from "./fixes.ts";
import { isTarget, type WorkspaceLinter } from "./workspace.ts";

export interface FixRepositorySlot {
  repository: FixRepository;
}

export interface ValidationDependencies {
  readonly document: (uri: string) => TextDocument | undefined;
  readonly settings: () => ServerInitializationOptions;
  readonly lookupLinter: (document: TextDocument) => readonly [string, WorkspaceLinter | undefined];
  readonly trace: (message: string, data?: unknown) => void;
  readonly sendDiagnostics: (uri: string, diagnostics: readonly Diagnostic[]) => void;
  readonly withProgress: <T>(task: () => Promise<T>) => Promise<T>;
  readonly sendOk: () => void;
  readonly sendError: (error: unknown) => void;
  readonly sendErrors: (errors: readonly string[]) => void;
}

interface ValidationContext {
  readonly dependencies: ValidationDependencies;
  readonly repositories: Map<string, FixRepositorySlot>;
}

export interface ValidationService {
  readonly open: (document: TextDocument) => void;
  readonly close: (document: TextDocument) => void;
  readonly validate: (document: TextDocument) => Promise<void>;
  readonly validateSingle: (document: TextDocument) => Promise<void>;
  readonly validateMany: (documents: readonly TextDocument[]) => Promise<void>;
  readonly prepareRevalidation: () => TextDocument[];
  readonly repository: (uri: string) => FixRepositorySlot | undefined;
}

function publishValidation(
  context: ValidationContext,
  uri: string,
  version: number,
  slot: FixRepositorySlot,
  entries: readonly DiagnosticEntry[],
): boolean {
  const { dependencies, repositories } = context;
  if (dependencies.document(uri)?.version !== version || repositories.get(uri) !== slot) {
    dependencies.trace(`discard stale validation ${uri}`, version);
    return false;
  }
  slot.repository = replaceFixRepository(version, entries);
  dependencies.trace(`sendDiagnostics ${uri}`);
  dependencies.sendDiagnostics(
    uri,
    entries.map(([, diagnostic]) => diagnostic),
  );
  return true;
}

async function scanIgnored(
  engine: WorkspaceLinter,
  filePath: string,
  trace: ValidationDependencies["trace"],
): Promise<boolean> {
  const scanResult = await engine.linter.scanFilePath?.(filePath);
  if (scanResult?.status === "ignored") {
    trace(`ignore ${URI.file(filePath).toString()}`);
    return true;
  }
  if (
    scanResult?.status === "error" &&
    scanResult.errors.some((error) => error.type !== "ScanFilePathNoExistFilePathError")
  ) {
    throw new Error(scanResult.errors.map((error) => error.type).join(", "));
  }
  return false;
}

async function lintDocument(
  context: ValidationContext,
  document: TextDocument,
  slot: FixRepositorySlot,
): Promise<void> {
  const { dependencies } = context;
  const uri = URI.parse(document.uri);
  const [folder, engine] = dependencies.lookupLinter(document);
  const supported =
    engine?.availableExtensions.includes(URIUtils.extname(uri)) === true &&
    isTarget(folder, uri, dependencies.settings().targetPath);
  if (!engine || !supported) {
    publishValidation(context, document.uri, document.version, slot, []);
    return;
  }
  if (await scanIgnored(engine, uri.fsPath, dependencies.trace)) {
    publishValidation(context, document.uri, document.version, slot, []);
    return;
  }
  const result = await engine.linter.lintText(document.getText(), uri.fsPath);
  dependencies.trace("result", result);
  publishValidation(
    context,
    document.uri,
    document.version,
    slot,
    result.messages.map((message) => toDiagnostic(message)),
  );
}

async function validateDocument(context: ValidationContext, document: TextDocument): Promise<void> {
  const { dependencies, repositories } = context;
  dependencies.trace(`validate ${document.uri}`);
  if (!document.uri.startsWith("file:")) {
    dependencies.trace("validation skipped...");
    return;
  }
  const slot = repositories.get(document.uri);
  if (!slot) {
    return;
  }
  try {
    await lintDocument(context, document, slot);
  } catch (error) {
    if (publishValidation(context, document.uri, document.version, slot, [])) {
      throw error;
    }
  }
}

function validateSingle(context: ValidationContext, document: TextDocument): Promise<void> {
  return context.dependencies.withProgress(async () => {
    try {
      await validateDocument(context, document);
      context.dependencies.sendOk();
    } catch (error) {
      context.dependencies.sendError(error);
    }
  });
}

function validateMany(
  context: ValidationContext,
  documents: readonly TextDocument[],
): Promise<void> {
  return context.dependencies.withProgress(async () => {
    const errors: string[] = [];
    await Promise.all(
      documents.map(async (document) => {
        try {
          await validateDocument(context, document);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }),
    );
    context.dependencies.sendErrors(errors);
  });
}

function openDocument(context: ValidationContext, document: TextDocument): void {
  context.dependencies.trace(`onDidOpen ${document.uri}`);
  if (document.uri.startsWith("file:") && !context.repositories.has(document.uri)) {
    context.repositories.set(document.uri, { repository: emptyFixRepository() });
    void validateSingle(context, document);
  }
}

function closeDocument(context: ValidationContext, document: TextDocument): void {
  context.dependencies.trace(`onDidClose ${document.uri}`);
  if (document.uri.startsWith("file:")) {
    context.repositories.delete(document.uri);
    context.dependencies.sendDiagnostics(document.uri, []);
  }
}

function prepareRevalidation(context: ValidationContext): TextDocument[] {
  const documents: TextDocument[] = [];
  for (const uri of context.repositories.keys()) {
    context.dependencies.trace(`reConfigure:push ${uri}`);
    context.dependencies.sendDiagnostics(uri, []);
    const document = context.dependencies.document(uri);
    if (document) {
      documents.push(document);
    }
  }
  return documents;
}

export function createValidationService(dependencies: ValidationDependencies): ValidationService {
  const context: ValidationContext = { dependencies, repositories: new Map() };
  return {
    open: (document: TextDocument) => {
      openDocument(context, document);
    },
    close: (document: TextDocument) => {
      closeDocument(context, document);
    },
    validate: (document: TextDocument) => validateDocument(context, document),
    validateSingle: (document: TextDocument) => validateSingle(context, document),
    validateMany: (documents: readonly TextDocument[]) => validateMany(context, documents),
    prepareRevalidation: () => prepareRevalidation(context),
    repository: (uri: string) => context.repositories.get(uri),
  };
}
