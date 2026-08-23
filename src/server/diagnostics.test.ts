import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { toDiagnostic, toDiagnosticSeverity } from "./diagnostics.ts";
import { textlintMessage } from "./test-fixtures.ts";

void describe("diagnostic core", () => {
  void test("maps every textlint severity", () => {
    assert.strictEqual(toDiagnosticSeverity(2), DiagnosticSeverity.Error);
    assert.strictEqual(toDiagnosticSeverity(1), DiagnosticSeverity.Warning);
    assert.strictEqual(toDiagnosticSeverity(0), DiagnosticSeverity.Information);
    assert.strictEqual(toDiagnosticSeverity(3), DiagnosticSeverity.Information);
  });

  void test("preserves the current message-based range behavior", () => {
    const plain = toDiagnostic(textlintMessage("plain", [2, 5]))[1];
    const arrow = toDiagnostic(textlintMessage("arrow", [2, 5], "arrow", "before -> after"))[1];
    const quoted = toDiagnostic(textlintMessage("quoted", [2, 5], "quoted", 'replace "word"'))[1];

    assert.deepStrictEqual(plain.range, {
      start: { line: 0, character: 2 },
      end: { line: 0, character: 2 },
    });
    assert.strictEqual(arrow.range.end.character, 8);
    assert.strictEqual(quoted.range.end.character, 6);
  });
});
