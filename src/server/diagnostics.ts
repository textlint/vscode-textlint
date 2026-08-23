import { DiagnosticSeverity, Position, Range } from "vscode-languageserver/node";
import type { Diagnostic } from "vscode-languageserver/node";
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

export function toDiagnostic(message: TextlintMessage): DiagnosticEntry {
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
  return [
    message,
    {
      message: message.message,
      severity: toDiagnosticSeverity(message.severity),
      source: "textlint",
      range: Range.create(startPosition, endPosition),
      code: message.ruleId,
    },
  ];
}
