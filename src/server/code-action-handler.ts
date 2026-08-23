import type { CodeAction, CodeActionParams } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { createCodeActions, requestedCodeActionKinds } from "./code-actions.ts";
import { hasFixes } from "./fixes.ts";
import type { FixRepositorySlot } from "./validation.ts";

export interface CodeActionHandlerDependencies {
  readonly document: (uri: string) => TextDocument | undefined;
  readonly repository: (uri: string) => FixRepositorySlot | undefined;
  readonly validate: (document: TextDocument) => Promise<void>;
  readonly trace: (message: string, data?: unknown) => void;
  readonly sendError: (error: unknown) => void;
}

export interface CodeActionHandler {
  readonly handle: (params: CodeActionParams) => Promise<CodeAction[]>;
}

export function createCodeActionHandler(
  dependencies: CodeActionHandlerDependencies,
): CodeActionHandler {
  return {
    handle: async (params: CodeActionParams): Promise<CodeAction[]> => {
      dependencies.trace("onCodeAction", params);
      const uri = params.textDocument.uri;
      const document = dependencies.document(uri);
      const initialSlot = dependencies.repository(uri);
      if (!initialSlot || !document) {
        return [];
      }
      const kinds = requestedCodeActionKinds(params.context.only);
      if (!kinds.quickFix && !kinds.sourceFixAll) {
        return [];
      }
      const version = document.version;
      if (kinds.sourceFixAll || initialSlot.repository.version !== version) {
        try {
          await dependencies.validate(document);
        } catch (error) {
          dependencies.sendError(error);
          return [];
        }
      }
      const slot = dependencies.repository(uri);
      if (
        dependencies.document(uri)?.version !== version ||
        slot !== initialSlot ||
        slot.repository.version !== version ||
        !hasFixes(slot.repository)
      ) {
        return [];
      }
      return createCodeActions(document, slot.repository, params.context.diagnostics, kinds);
    },
  };
}
