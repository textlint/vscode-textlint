import type { TextlintMessage, TextlintMessageFixCommand } from "@textlint/types";
import type { Diagnostic } from "vscode-languageserver";
import type { DiagnosticEntry } from "./diagnostics.ts";

export interface AutoFix {
  readonly ruleId: string;
  readonly fix: TextlintMessageFixCommand;
  readonly diagnostic: Diagnostic;
}

export interface FixRepository {
  readonly version: number;
  readonly fixes: readonly AutoFix[];
}

export function emptyFixRepository(): FixRepository {
  return { version: -1, fixes: [] };
}

export function replaceFixRepository(
  version: number,
  entries: readonly DiagnosticEntry[],
): FixRepository {
  return {
    version,
    fixes: entries.flatMap(([message, diagnostic]) => toAutoFix(message, diagnostic)),
  };
}

function toAutoFix(message: TextlintMessage, diagnostic: Diagnostic): readonly AutoFix[] {
  return message.fix ? [{ diagnostic, ruleId: message.ruleId, fix: message.fix }] : [];
}

function diagnosticsEqual(left: Diagnostic, right: Diagnostic): boolean {
  return (
    left.source === right.source &&
    left.code === right.code &&
    left.message === right.message &&
    left.range.start.line === right.range.start.line &&
    left.range.start.character === right.range.start.character &&
    left.range.end.line === right.range.end.line &&
    left.range.end.character === right.range.end.character
  );
}

export function findMatchingFixes(
  repository: FixRepository,
  diagnostics: readonly Diagnostic[],
): AutoFix[] {
  return repository.fixes.filter((fix) =>
    diagnostics.some((diagnostic) => diagnosticsEqual(diagnostic, fix.diagnostic)),
  );
}

export function hasFixes(repository: FixRepository): boolean {
  return repository.fixes.length > 0;
}

export function separatedFixes(
  repository: FixRepository,
  filter: (fix: AutoFix) => boolean = () => true,
): AutoFix[] {
  const candidates = repository.fixes
    .filter(filter)
    .toSorted(
      (left, right) =>
        right.fix.range[1] - left.fix.range[1] || right.fix.range[0] - left.fix.range[0],
    );
  const result = candidates.slice(0, 1);
  for (const fix of candidates.slice(1)) {
    const last = result.at(-1);
    if (!last) {
      break;
    }
    if (fix.fix.range[1] <= last.fix.range[0]) {
      result.push(fix);
    }
  }
  return result.toReversed();
}
