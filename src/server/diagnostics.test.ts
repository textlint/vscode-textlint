import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { toDiagnostic, toDiagnosticSeverity } from "./diagnostics.ts";
import { textlintMessage } from "./test-fixtures.ts";

void describe("diagnostic core", () => {
  void test("maps every textlint severity", () => {
    assert.strictEqual(toDiagnosticSeverity(2), DiagnosticSeverity.Error);
    assert.strictEqual(toDiagnosticSeverity(1), DiagnosticSeverity.Warning);
    assert.strictEqual(toDiagnosticSeverity(0), DiagnosticSeverity.Information);
    assert.strictEqual(toDiagnosticSeverity(3), DiagnosticSeverity.Information);
  });
});

void describe("diagnostic ranges", () => {
  void test("uses textlint ranges for single-line and zero-width diagnostics", () => {
    const textDocument = TextDocument.create("file:///test.txt", "plaintext", 1, "0123456789");
    const word = toDiagnostic(textDocument, textlintMessage("word", [2, 5]))[1];
    const insertion = toDiagnostic(textDocument, textlintMessage("insert", [7, 7]))[1];

    assert.deepStrictEqual(word.range, {
      start: { line: 0, character: 2 },
      end: { line: 0, character: 5 },
    });
    assert.deepStrictEqual(insertion.range, {
      start: { line: 0, character: 7 },
      end: { line: 0, character: 7 },
    });
  });

  void test("converts multiline and surrogate-pair offsets with the document", () => {
    const textDocument = TextDocument.create("file:///test.txt", "plaintext", 1, "😀abc\ndef");
    const multiline = toDiagnostic(textDocument, textlintMessage("multiline", [2, 8]))[1];

    assert.deepStrictEqual(multiline.range, {
      start: { line: 0, character: 2 },
      end: { line: 1, character: 2 },
    });
  });
});
