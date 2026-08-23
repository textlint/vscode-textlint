// Shared builders for colocated server unit tests.
import type { TextlintMessage } from "@textlint/types";
import type { Diagnostic } from "vscode-languageserver";

export function textlintMessage(
  ruleId: string,
  range: readonly [number, number],
  text = ruleId,
  message = ruleId,
): TextlintMessage {
  const legacyPosition = {
    line: 1,
    column: range[0] + 1,
    index: range[0],
  };
  return {
    ...legacyPosition,
    type: "lint",
    ruleId,
    message,
    range,
    loc: {
      start: { line: 1, column: range[0] + 1 },
      end: { line: 1, column: range[1] + 1 },
    },
    severity: 2,
    fix: { range, text },
  };
}

export function diagnostic(message: TextlintMessage): Diagnostic {
  return {
    source: "textlint",
    code: message.ruleId,
    message: message.message,
    range: {
      start: { line: message.loc.start.line - 1, character: message.loc.start.column - 1 },
      end: { line: message.loc.end.line - 1, character: message.loc.end.column - 1 },
    },
  };
}
