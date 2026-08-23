import { CodeActionKind, Range, TextDocumentEdit, TextEdit } from "vscode-languageserver/node";
import type { CodeAction, Diagnostic } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { findMatchingFixes, separatedFixes, type AutoFix, type FixRepository } from "./fixes.ts";

export const sourceFixAllTextlint = `${CodeActionKind.SourceFixAll}.textlint`;

export interface RequestedCodeActionKinds {
  readonly quickFix: boolean;
  readonly sourceFixAll: boolean;
}

export function requestedCodeActionKinds(only?: readonly string[]): RequestedCodeActionKinds {
  return {
    quickFix:
      only === undefined ||
      only.some((kind) => kind === CodeActionKind.Empty || kind === CodeActionKind.QuickFix),
    sourceFixAll:
      only?.some((kind) =>
        [
          CodeActionKind.Empty,
          CodeActionKind.Source,
          CodeActionKind.SourceFixAll,
          sourceFixAllTextlint,
        ].includes(kind),
      ) ?? false,
  };
}

function toTextEdit(textDocument: TextDocument, autoFix: AutoFix): TextEdit {
  return TextEdit.replace(
    Range.create(
      textDocument.positionAt(autoFix.fix.range[0]),
      textDocument.positionAt(autoFix.fix.range[1]),
    ),
    autoFix.fix.text,
  );
}

function toWorkspaceEdit(textDocument: TextDocument, repository: FixRepository, fixes: AutoFix[]) {
  return {
    documentChanges: [
      TextDocumentEdit.create(
        { uri: textDocument.uri, version: repository.version },
        fixes.map((fix) => toTextEdit(textDocument, fix)),
      ),
    ],
  };
}

export function createCodeActions(
  textDocument: TextDocument,
  repository: FixRepository,
  diagnostics: readonly Diagnostic[],
  kinds: RequestedCodeActionKinds,
): CodeAction[] {
  const requestedFixes = kinds.quickFix ? findMatchingFixes(repository, diagnostics) : [];
  const quickFixes: CodeAction[] = requestedFixes.map((fix) => ({
    title: `Fix this ${fix.ruleId} problem`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [fix.diagnostic],
    edit: toWorkspaceEdit(textDocument, repository, [fix]),
  }));
  const sameRuleFixes: CodeAction[] = [...new Set(requestedFixes.map((fix) => fix.ruleId))].flatMap(
    (ruleId) => {
      const fixes = separatedFixes(repository, (fix) => fix.ruleId === ruleId);
      return fixes.length > 1
        ? [
            {
              title: `Fix all ${ruleId} problems`,
              kind: CodeActionKind.QuickFix,
              diagnostics: fixes.map((fix) => fix.diagnostic),
              edit: toWorkspaceEdit(textDocument, repository, fixes),
            },
          ]
        : [];
    },
  );
  const sourceFixes: CodeAction[] = kinds.sourceFixAll
    ? [
        {
          title: "Fix all auto-fixable textlint problems",
          kind: sourceFixAllTextlint,
          edit: toWorkspaceEdit(textDocument, repository, separatedFixes(repository)),
        },
      ]
    : [];
  return [...quickFixes, ...sameRuleFixes, ...sourceFixes];
}
