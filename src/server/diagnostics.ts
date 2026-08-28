import { DiagnosticSeverity, Range } from "vscode-languageserver/node";
import type { Diagnostic } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { TextlintMessage } from "@textlint/types";

export type DiagnosticEntry = readonly [TextlintMessage, Diagnostic];

export function toDiagnosticSeverity(severity: TextlintMessage["severity"]): DiagnosticSeverity {
  switch (severity) {
    case 2:
      return DiagnosticSeverity.Error;
    case 1:
      return DiagnosticSeverity.Warning;
    case 0:
    case 3:
      return DiagnosticSeverity.Information;
    default:
      return DiagnosticSeverity.Information;
  }
}

export function toDiagnostic(document: TextDocument, message: TextlintMessage): DiagnosticEntry {
  return [
    message,
    {
      message: message.message,
      severity: toDiagnosticSeverity(message.severity),
      source: "textlint",
      range: Range.create(
        document.positionAt(message.range[0]),
        document.positionAt(message.range[1]),
      ),
      code: message.ruleId,
    },
  ];
}
