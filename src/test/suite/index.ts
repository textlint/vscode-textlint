import * as path from "path";
import { pathToFileURL } from "url";
import type * as ExtensionTest from "./extension.test";

export async function run(): Promise<void> {
  const testPath = path.resolve(process.cwd(), "src/test/suite/extension.test.ts");
  const testModule: typeof ExtensionTest = await import(pathToFileURL(testPath).href);
  await testModule.testsDone;
}
