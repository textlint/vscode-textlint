import * as path from "node:path";
import minimatch from "minimatch";
import { URI } from "vscode-uri";
import type { createLinter } from "textlint";
import type { TextDocument } from "vscode-languageserver-textdocument";

type TextlintLinter = ReturnType<typeof createLinter>;

export interface WorkspaceLinter {
  readonly linter: {
    readonly lintText: TextlintLinter["lintText"];
    readonly scanFilePath?: TextlintLinter["scanFilePath"];
  };
  readonly availableExtensions: readonly string[];
}

export type WorkspaceLinterEntry = readonly [string, WorkspaceLinter];

export function configCandidatePattern(root: string): string {
  return `${root}/.textlintr{c.js,c.yaml,c.yml,c,c.json}`;
}

export function defaultIgnorePath(root: string, configuredPath: string | null): string {
  return configuredPath ?? path.resolve(root, ".textlintignore");
}

export function isTarget(rootUri: string, fileUri: URI, targetPath: string): boolean {
  const relativePath = path.posix.relative(URI.parse(rootUri).path, fileUri.path);
  return (
    targetPath === "" ||
    minimatch(relativePath, targetPath, {
      matchBase: true,
    })
  );
}

export function uriStartsWith(target: string, prefix: string): boolean {
  if (target.length < prefix.length) {
    return false;
  }
  const targetElements = target.split("/");
  const prefixElements = prefix.split("/");
  return prefixElements.every((element, index) => element === targetElements[index]);
}

export function lookupWorkspaceLinter(
  entries: Iterable<WorkspaceLinterEntry>,
  document: Pick<TextDocument, "uri">,
): readonly [string, WorkspaceLinter | undefined] {
  for (const entry of entries) {
    if (uriStartsWith(document.uri, entry[0])) {
      return entry;
    }
  }
  return ["", undefined];
}
