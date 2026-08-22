import { window, StatusBarAlignment } from "vscode";
import type { TextEditor } from "vscode";

type StatusLogger = Readonly<{
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
}>;

export interface StatusInfo {
  readonly label: string;
  readonly color: string;
  readonly log: (logger: StatusLogger, message: string, data?: unknown) => void;
}

export const Status = {
  OK: {
    label: "textlint",
    color: "",
    log(logger, message, data) {
      logger.info(message, data);
    },
  },
  WARN: {
    label: "textlint: Warning",
    color: "yellow",
    log(logger, message, data) {
      logger.warn(message, data);
    },
  },
  ERROR: {
    label: "textlint: Error",
    color: "darkred",
    log(logger, message, data) {
      logger.error(message, data);
    },
  },
} as const satisfies Record<"OK" | "WARN" | "ERROR", StatusInfo>;

export class StatusBar {
  private readonly delegate = window.createStatusBarItem(StatusBarAlignment.Right, 0);
  private readonly supports: readonly string[];
  private currentStatus: StatusInfo = Status.OK;
  private isServerRunning = false;

  constructor(supports: readonly string[]) {
    this.supports = supports;
    this.delegate.text = this.currentStatus.label;
    window.onDidChangeActiveTextEditor((editor) => {
      this.updateWith(editor);
    });
    this.update();
  }

  dispose() {
    this.delegate.dispose();
  }

  show(show: boolean) {
    if (show) {
      this.delegate.show();
    } else {
      this.delegate.hide();
    }
  }

  activate(languageId: string) {
    if (languageId === "") {
      return;
    }

    if (this.supports.includes(languageId)) {
      this.delegate.color = "";
      this.delegate.tooltip =
        "need to restart this extension or check this extension setting and .textlintrc if textlint is not working.";
    } else {
      this.delegate.color = "#818589";
      this.delegate.tooltip = `textlint is inactive on ${languageId}.`;
    }
  }

  get status(): StatusInfo {
    return this.currentStatus;
  }

  setStatus(status: Readonly<StatusInfo>) {
    this.currentStatus = status;
    this.update();
  }

  get serverRunning(): boolean {
    return this.isServerRunning;
  }

  setServerRunning(serverRunning: boolean) {
    this.isServerRunning = serverRunning;
    void window.showInformationMessage(
      serverRunning ? "textlint server is running." : "textlint server stopped.",
    );
    this.update();
  }

  update() {
    this.updateWith(window.activeTextEditor);
  }

  updateWith(editor: TextEditor | undefined) {
    this.delegate.text = this.status.label;
    const languageId = editor?.document.languageId ?? "";
    this.activate(languageId);

    const shouldShowStatusBar =
      !this.serverRunning || this.currentStatus !== Status.OK || this.supports.includes(languageId);
    this.show(shouldShowStatusBar);
  }
}
