import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as os from "node:os";
import { Files } from "vscode-languageserver/node";
import type { WorkspaceFolder } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import type { ServerInitializationOptions } from "../shared/types.ts";
import {
  configCandidatePattern,
  defaultIgnorePath,
  lookupWorkspaceLinter,
  type WorkspaceLinter,
} from "./workspace.ts";

type TextlintModule = Pick<typeof import("textlint"), "createLinter" | "loadTextlintrc">;
type LinterMap = Map<string, WorkspaceLinter>;

export interface WorkspaceLinterDependencies {
  readonly settings: () => ServerInitializationOptions;
  readonly trace: (message: string, data?: unknown) => void;
  readonly notifyNoConfig: (workspaceFolder: string) => void;
  readonly notifyNoLibrary: (workspaceFolder: string) => void;
}

export interface WorkspaceLinterService {
  readonly configure: (folders: readonly WorkspaceFolder[] | null) => Promise<void>;
  readonly remove: (folderUri: string) => void;
  readonly lookup: (document: TextDocument) => readonly [string, WorkspaceLinter | undefined];
}

const runtimeRequire = createRequire(import.meta.url);

export interface WorkspaceLinterDiscovery {
  readonly findConfig: (root: string) => string | undefined;
  readonly findIgnore: (root: string) => string | undefined;
  readonly resolveModule: (root: string) => Promise<TextlintModule>;
}

function configCandidates(root: string): string[] {
  return fs.globSync(configCandidatePattern(root));
}

export interface ConfigFileCandidates {
  readonly workspace: () => string | undefined;
  readonly configured: () => string | undefined;
  readonly home: () => string | undefined;
}

export function selectConfigFile(candidates: ConfigFileCandidates): string | undefined {
  return candidates.workspace() ?? candidates.configured() ?? candidates.home();
}

function findConfig(dependencies: WorkspaceLinterDependencies, root: string): string | undefined {
  const settings = dependencies.settings();
  return selectConfigFile({
    workspace: () => configCandidates(root)[0],
    configured: () =>
      settings.configPath !== null && fs.existsSync(settings.configPath)
        ? settings.configPath
        : undefined,
    home: () => configCandidates(os.homedir())[0],
  });
}

function findIgnore(dependencies: WorkspaceLinterDependencies, root: string): string | undefined {
  const ignorePath = defaultIgnorePath(root, dependencies.settings().ignorePath);
  return fs.existsSync(ignorePath) ? ignorePath : undefined;
}

function loadModule(moduleName: string): TextlintModule {
  const module: unknown = runtimeRequire(moduleName);
  if (!isTextlintModule(module)) {
    throw new TypeError(`${moduleName} does not provide the textlint API`);
  }
  return module;
}

async function resolveModule(
  dependencies: WorkspaceLinterDependencies,
  root: string,
): Promise<TextlintModule> {
  dependencies.trace(`Module textlint resolve from ${root}`);
  const modulePath = await Files.resolveModulePath(
    root,
    "textlint",
    dependencies.settings().nodePath ?? "",
    dependencies.trace,
  );
  dependencies.trace(`Module textlint got resolved to ${modulePath}`);
  return loadModule(modulePath);
}

function createDiscovery(dependencies: WorkspaceLinterDependencies): WorkspaceLinterDiscovery {
  return {
    findConfig: (root: string) => findConfig(dependencies, root),
    findIgnore: (root: string) => findIgnore(dependencies, root),
    resolveModule: (root: string) => resolveModule(dependencies, root),
  };
}

async function resolveWorkspaceModule(
  dependencies: WorkspaceLinterDependencies,
  discovery: WorkspaceLinterDiscovery,
  root: string,
): Promise<TextlintModule> {
  try {
    return await discovery.resolveModule(root);
  } catch (error) {
    dependencies.notifyNoLibrary(root);
    throw error;
  }
}

async function configureFolder(
  dependencies: WorkspaceLinterDependencies,
  discovery: WorkspaceLinterDiscovery,
  linters: LinterMap,
  folder: WorkspaceFolder,
): Promise<void> {
  dependencies.trace(`configureEngine ${folder.uri}`);
  const root = URI.parse(folder.uri).fsPath;
  try {
    const configFile = discovery.findConfig(root);
    if (configFile === undefined) {
      dependencies.notifyNoConfig(root);
    }
    const module = await resolveWorkspaceModule(dependencies, discovery, root);
    const ignoreFile = discovery.findIgnore(root);
    const descriptor = await module.loadTextlintrc({
      configFilePath: configFile,
    });
    linters.set(folder.uri, {
      linter: module.createLinter({
        descriptor,
        ignoreFilePath: ignoreFile,
      }),
      availableExtensions: descriptor.availableExtensions,
    });
  } catch (error) {
    dependencies.trace("failed to configureEngine", error);
  }
}

function lookupLinter(
  dependencies: WorkspaceLinterDependencies,
  linters: LinterMap,
  document: TextDocument,
): readonly [string, WorkspaceLinter | undefined] {
  dependencies.trace(`lookupEngine ${document.uri}`);
  const entry = lookupWorkspaceLinter(linters.entries(), document);
  dependencies.trace(
    entry[1]
      ? `lookupEngine ${document.uri} => ${entry[0]}`
      : `lookupEngine ${document.uri} not found`,
  );
  return entry;
}

export function createWorkspaceLinterService(
  dependencies: WorkspaceLinterDependencies,
  discovery: WorkspaceLinterDiscovery = createDiscovery(dependencies),
): WorkspaceLinterService {
  const linters = new Map<string, WorkspaceLinter>();
  return {
    configure: async (folders: readonly WorkspaceFolder[] | null) => {
      await Promise.all(
        (folders ?? []).map((folder) => configureFolder(dependencies, discovery, linters, folder)),
      );
    },
    remove: (folderUri: string) => {
      linters.delete(folderUri);
    },
    lookup: (document: TextDocument) => lookupLinter(dependencies, linters, document),
  };
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
