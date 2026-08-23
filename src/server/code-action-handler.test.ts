import assert from "node:assert/strict";
import { test } from "node:test";
import { Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { sourceFixAllTextlint } from "./code-actions.ts";
import { createCodeActionHandler } from "./code-action-handler.ts";
import { emptyFixRepository, replaceFixRepository } from "./fixes.ts";
import { diagnostic, textlintMessage } from "./test-fixtures.ts";
import type { FixRepositorySlot } from "./validation.ts";

void test("code action handler rejects validation from a replaced document lifecycle", async () => {
  const uri = "file:///test.txt";
  let document = TextDocument.create(uri, "plaintext", 1, "yuo");
  let slot: FixRepositorySlot = { repository: emptyFixRepository() };
  const handler = createCodeActionHandler({
    document: () => document,
    repository: () => slot,
    validate: () => {
      const message = textlintMessage("spell", [0, 3], "you");
      document = TextDocument.create(uri, "plaintext", 1, "yuo");
      slot = { repository: replaceFixRepository(1, [[message, diagnostic(message)]]) };
      return Promise.resolve();
    },
    trace: () => {},
    sendError: () => {},
  });

  const actions = await handler.handle({
    textDocument: { uri },
    range: Range.create(0, 0, 0, 3),
    context: { diagnostics: [], only: [sourceFixAllTextlint] },
  });

  assert.deepStrictEqual(actions, []);
});
