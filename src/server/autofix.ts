import type { TextlintMessage, TextlintMessageFixCommand } from "@textlint/types";
import type { Diagnostic } from "vscode-languageserver";

export interface AutoFix {
  ruleId: string;
  fix: TextlintMessageFixCommand;
  diagnostic: Diagnostic;
}

export class TextlintFixRepository {
  private fixes: AutoFix[] = [];
  private documentVersion = -1;

  replace(version: number, entries: [TextlintMessage, Diagnostic][]) {
    this.fixes = entries.flatMap(([message, diagnostic]) =>
      message.fix
        ? [
            {
              diagnostic,
              ruleId: message.ruleId,
              fix: message.fix,
            },
          ]
        : [],
    );
    this.documentVersion = version;
  }

  findMatching(diagnostics: Diagnostic[]): AutoFix[] {
    return this.fixes.filter((fix) =>
      diagnostics.some(
        (diagnostic) =>
          diagnostic.source === fix.diagnostic.source &&
          diagnostic.code === fix.diagnostic.code &&
          diagnostic.message === fix.diagnostic.message &&
          diagnostic.range.start.line === fix.diagnostic.range.start.line &&
          diagnostic.range.start.character === fix.diagnostic.range.start.character &&
          diagnostic.range.end.line === fix.diagnostic.range.end.line &&
          diagnostic.range.end.character === fix.diagnostic.range.end.character,
      ),
    );
  }

  isEmpty(): boolean {
    return this.fixes.length === 0;
  }

  get version(): number {
    return this.documentVersion;
  }

  separatedValues(filter: (fix: AutoFix) => boolean = () => true): AutoFix[] {
    const candidates = this.fixes
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
      const lastStart = last.fix.range[0];
      if (fix.fix.range[1] <= lastStart) {
        result.push(fix);
      }
    }
    return result.toReversed();
  }
}
