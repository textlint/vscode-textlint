import * as path from "path";
import { execSync } from "child_process";

import { runTests } from "@vscode/test-electron";

async function main() {
  try {
    const extensionDevelopmentPath = process.cwd();
    const extensionTestsPath = path.resolve(extensionDevelopmentPath, "src/test/suite/index.ts");
    const workspaceFolder = path.resolve(extensionDevelopmentPath, "tests/fixtures/single-root-workspace");

    try {
      execSync("npm ci", {
        cwd: workspaceFolder,
        stdio: "inherit",
      });
    } catch (error) {
      console.error("Failed to install dependencies with npm ci");
      console.error(error);
      process.exit(1);
    }

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspaceFolder, "--disable-extensions"],
    });
  } catch (err) {
    console.error("Failed to run tests");
    console.error(err);
    process.exit(1);
  }
}

main();
