import * as path from "path";
import { execSync } from "child_process";

import { runTests } from "@vscode/test-electron";

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to the extension test script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./index");

    const workspaceFolder = path.resolve(__dirname, "../../../test");

    try {
      console.log("Running npm ci...");
      execSync("npm ci", {
        cwd: workspaceFolder,
        stdio: "inherit",
      });
      console.log("Dependencies installed successfully");
    } catch (error) {
      console.error("Failed to install dependencies with npm ci");
      console.error(error);
      process.exit(1);
    }

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspaceFolder, "--disable-extensions"],
    });
  } catch (err) {
    console.error("Failed to run tests");
    process.exit(1);
  }
}

main();
