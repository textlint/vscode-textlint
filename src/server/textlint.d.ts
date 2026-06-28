import type { TextlintFixResult, TextlintResult } from "@textlint/types";

type ScanFilePathResult =
  | {
      status: "ok";
    }
  | {
      status: "ignored";
    }
  | {
      status: "error";
    };

type TextlintKernelDescriptor = unknown;
export type CreateLinterOptions = {
  descriptor: TextlintKernelDescriptor;
  ignoreFilePath?: string;
  quiet?: boolean;
  cache?: boolean;
  cacheLocation?: string;
};
export type createLinter = (options: CreateLinterOptions) => {
  lintFiles(files: string[]): Promise<TextlintResult[]>;
  lintText(text: string, filePath: string): Promise<TextlintResult>;
  fixFiles(files: string[]): Promise<TextlintFixResult[]>;
  fixText(text: string, filePath: string): Promise<TextlintFixResult>;
  scanFilePath?(filePath: string): Promise<ScanFilePathResult>;
};
