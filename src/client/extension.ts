import { workspace, window, commands, ExtensionContext, QuickPickItem, WorkspaceFolder } from "vscode";

import { State as ServerState, ErrorHandler, CloseAction, RevealOutputChannelOn } from "vscode-languageclient";

import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";

import { LogTraceNotification } from "vscode-jsonrpc";

import { Utils as URIUtils } from "vscode-uri";

import {
  StatusNotification,
  NoConfigNotification,
  NoLibraryNotification,
  ExitNotification,
  ServerInitializationOptions,
  ExtensionSettings,
  defaultServerInitializationOptions,
} from "../shared/types";

import { Status, StatusBar } from "./status";

const defaultConfig: ExtensionSettings = {
  ...defaultServerInitializationOptions,
  languages: [],
};

export interface ExtensionInternal {
  client: LanguageClient;
  statusBar: StatusBar;
}

export async function activate(context: ExtensionContext): Promise<ExtensionInternal> {
  const client = newClient(context);
  const statusBar = new StatusBar(readConfig().languages);
  client.onDidChangeState((event) => {
    statusBar.serverRunning = event.newState === ServerState.Running;
  });
  client.onNotification(StatusNotification.type, (p: StatusNotification.StatusParams) => {
    statusBar.status = to(p.status);
    if (p.message || p.cause) {
      statusBar.status.log(client, p.message ?? "", p.cause);
    }
  });
  client.onNotification(NoConfigNotification.type, (p) => {
    statusBar.status = Status.WARN;
    statusBar.status.log(
      client,
      `No textlint configuration (e.g .textlintrc) found in ${p.workspaceFolder} .
File will not be validated. Consider running the 'Create .textlintrc file' command.`
    );
  });
  client.onNotification(NoLibraryNotification.type, (p) => {
    statusBar.status = Status.WARN;
    statusBar.status.log(
      client,
      `Failed to load the textlint library in ${p.workspaceFolder} .
To use textlint in this workspace please install textlint using 'npm install textlint' or globally using 'npm install -g textlint'.
You need to reopen the workspace after installing textlint.`
    );
  });
  client.onNotification(LogTraceNotification.type, (p) => client.info(p.message, p.verbose));
  context.subscriptions.push(
    commands.registerCommand("textlint.createConfig", createConfig),
    commands.registerCommand("textlint.showOutputChannel", () => client.outputChannel.show()),
    client,
    statusBar
  );
  await client.start();
  // for testing purpose
  return {
    client,
    statusBar,
  };
}

function newClient(context: ExtensionContext): LanguageClient {
  const module = URIUtils.joinPath(context.extensionUri, "dist", "server.js").fsPath;
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6011"] };

  const serverOptions: ServerOptions = {
    run: { module, transport: TransportKind.ipc },
    debug: { module, transport: TransportKind.ipc, options: debugOptions },
  };

  // eslint-disable-next-line prefer-const
  let defaultErrorHandler: ErrorHandler;
  let serverCalledProcessExit = false;
  const textlintConfig = readConfig();
  const clientOptions: LanguageClientOptions = {
    documentSelector: textlintConfig.languages.map((id) => {
      return { language: id, scheme: "file" };
    }),
    diagnosticCollectionName: "textlint",
    revealOutputChannelOn: RevealOutputChannelOn.Error,
    synchronize: {
      configurationSection: "textlint",
      fileEvents: [
        workspace.createFileSystemWatcher("**/package.json"),
        workspace.createFileSystemWatcher("**/.textlintrc"),
        workspace.createFileSystemWatcher("**/.textlintrc.{js,json,yml,yaml}"),
        workspace.createFileSystemWatcher("**/.textlintignore"),
      ],
    },
    initializationOptions: readInitializationOptions,
    initializationFailedHandler: (error) => {
      client.error("Server initialization failed.", error);
      return false;
    },
    errorHandler: {
      error: (error, message, count) => {
        return defaultErrorHandler.error(error, message, count);
      },
      closed: () => {
        if (serverCalledProcessExit) {
          return { action: CloseAction.DoNotRestart };
        }
        return defaultErrorHandler.closed();
      },
    },
  };

  const client = new LanguageClient("textlint", serverOptions, clientOptions);
  defaultErrorHandler = client.createDefaultErrorHandler();
  client.onNotification(ExitNotification.type, () => {
    serverCalledProcessExit = true;
  });
  return client;
}

async function createConfig() {
  const folders = workspace.workspaceFolders;
  if (!folders) {
    await window.showErrorMessage(
      "An textlint configuration can only be generated if VS Code is opened on a workspace folder."
    );
    return;
  }

  const noConfigs = await filterNoConfigFolders(folders);

  if (noConfigs.length < 1 && 0 < folders.length) {
    await window.showErrorMessage("textlint configuration file already exists in this workspace.");
    return;
  }

  if (noConfigs.length === 1) {
    await emitConfig(noConfigs[0]);
  } else {
    const item = await window.showQuickPick(toQuickPickItems(noConfigs));
    if (item) {
      await emitConfig(item.folder);
    }
  }
}

async function filterNoConfigFolders(folders: readonly WorkspaceFolder[]): Promise<WorkspaceFolder[]> {
  const result = [];
  outer: for (const folder of folders) {
    const candidates = ["", ".js", ".yaml", ".yml", ".json"].map((ext) =>
      URIUtils.joinPath(folder.uri, ".textlintrc" + ext)
    );
    for (const configPath of candidates) {
      try {
        await workspace.fs.stat(configPath);
        continue outer;
        // eslint-disable-next-line no-empty
      } catch {}
    }
    result.push(folder);
  }
  return result;
}

async function emitConfig(folder: WorkspaceFolder) {
  if (folder) {
    await workspace.fs.writeFile(
      URIUtils.joinPath(folder.uri, ".textlintrc"),
      Buffer.from(
        `{
  "filters": {},
  "rules": {}
}`,
        "utf8"
      )
    );
  }
}

function toQuickPickItems(folders: WorkspaceFolder[]): ({ folder: WorkspaceFolder } & QuickPickItem)[] {
  return folders.map((folder) => {
    return {
      label: folder.name,
      description: folder.uri.path,
      folder,
    };
  });
}

function readConfig(): ExtensionSettings {
  const config = workspace.getConfiguration("textlint");
  return {
    languages: config.get("languages", defaultConfig.languages),
    configPath: config.get("configPath", defaultConfig.configPath),
    ignorePath: config.get("ignorePath", defaultConfig.ignorePath),
    nodePath: config.get("nodePath", defaultConfig.nodePath),
    run: config.get("run", defaultConfig.run),
    trace: config.get("trace", defaultConfig.trace),
    targetPath: config.get("targetPath", defaultConfig.targetPath),
  };
}

function readInitializationOptions(): ServerInitializationOptions {
  const { configPath, ignorePath, nodePath, run, trace, targetPath } = readConfig();
  return { configPath, ignorePath, nodePath, run, trace, targetPath };
}

function to(status: StatusNotification.Status): Status {
  switch (status) {
    case StatusNotification.Status.OK:
      return Status.OK;
    case StatusNotification.Status.WARN:
      return Status.WARN;
    case StatusNotification.Status.ERROR:
      return Status.ERROR;
    default:
      return Status.ERROR;
  }
}
