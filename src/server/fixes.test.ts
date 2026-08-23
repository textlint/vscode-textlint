import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  emptyFixRepository,
  findMatchingFixes,
  hasFixes,
  replaceFixRepository,
  separatedFixes,
} from "./fixes.ts";
import { diagnostic, textlintMessage } from "./test-fixtures.ts";

void describe("fix repository core", () => {
  void test("replaces immutable repository data and matches diagnostics", () => {
    const message = textlintMessage("rule", [1, 4], "fixed");
    const entry = [message, diagnostic(message)] as const;
    const empty = emptyFixRepository();
    const repository = replaceFixRepository(7, [entry]);

    assert.strictEqual(hasFixes(empty), false);
    assert.strictEqual(hasFixes(repository), true);
    assert.strictEqual(empty.version, -1);
    assert.strictEqual(repository.version, 7);
    assert.deepStrictEqual(findMatchingFixes(repository, [entry[1]]), repository.fixes);
    assert.deepStrictEqual(findMatchingFixes(repository, [{ ...entry[1], message: "other" }]), []);
  });

  void test("keeps non-overlapping and same-position boundary insertions", () => {
    const messages = [
      textlintMessage("short", [0, 5]),
      textlintMessage("long", [0, 10]),
      textlintMessage("start", [0, 0]),
      textlintMessage("duplicate-start", [0, 0]),
      textlintMessage("first-end", [10, 10]),
      textlintMessage("second-end", [10, 10]),
    ];
    const repository = replaceFixRepository(
      1,
      messages.map((message) => [message, diagnostic(message)]),
    );

    assert.deepStrictEqual(
      separatedFixes(repository).map((fix) => fix.ruleId),
      ["duplicate-start", "start", "long", "second-end", "first-end"],
    );
  });
});
