import { NotificationType0, NotificationType } from "vscode-jsonrpc";

export type RunMode = "onSave" | "onType";
export type TraceMode = "off" | "messages" | "verbose";

export interface ServerInitializationOptions {
  configPath: string | null;
  ignorePath: string | null;
  nodePath: string | null;
  run: RunMode;
  trace: TraceMode;
  targetPath: string;
}

export interface ExtensionSettings extends ServerInitializationOptions {
  languages: string[];
}

export const defaultServerInitializationOptions: ServerInitializationOptions = {
  configPath: null,
  ignorePath: null,
  nodePath: null,
  run: "onSave",
  trace: "off",
  targetPath: "",
};

export namespace ExitNotification {
  export interface ExitParams {
    code: number;
    message: string;
  }
  export const type = new NotificationType<ExitParams>("textlint/exit");
}

export namespace StatusNotification {
  export enum Status {
    OK = 1,
    WARN = 2,
    ERROR = 3,
  }
  export interface StatusParams {
    status: Status;
    message?: string;
    cause?: unknown;
  }
  export const type = new NotificationType<StatusParams>("textlint/status");
}

export namespace NoConfigNotification {
  export const type = new NotificationType<Params>("textlint/noconfig");

  export interface Params {
    workspaceFolder: string;
  }
}

export namespace NoLibraryNotification {
  export const type = new NotificationType<Params>("textlint/nolibrary");
  export interface Params {
    workspaceFolder: string;
  }
}

export namespace StartProgressNotification {
  export const type = new NotificationType0("textlint/progress/start");
}

export namespace StopProgressNotification {
  export const type = new NotificationType0("textlint/progress/stop");
}
