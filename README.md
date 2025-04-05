# vscode-textlint

![integration-tests](https://github.com/textlint/vscode-textlint/actions/workflows/integration-tests.yaml/badge.svg)

Extension to integrate [textlint](https://textlint.github.io/) into VS Code.

## Installation

1. Visit [textlint - Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=3w36zj6.textlint)
2. Click the "Install" button

## Development setup

1. Open `vscode-textlint.code-workspace` in VS Code
2. Run `npm ci` in the **root** folder
3. Press F5 to build and launch the extension in debug mode

## Release process

1. Run `npm ci` in the **root** folder
2. Run `npm run package` in the **root** folder
3. Run `npx vsce publish --packagePath ./packages/textlint/textlint-*.vsix` in the **root** folder

## Acknowledgements

This project was originally created as [taichi/vscode-textlint](https://github.com/taichi/vscode-textlint).

Since [v0.12.0](https://github.com/textlint/vscode-textlint/releases/tag/v0.12.0), it has been transferred to the textlint organization for continued maintenance and development.

We'd like to express our gratitude to [@taichi](https://github.com/taichi) and all contributors. For more details, please see [github.com/orgs/textlint/discussions/2](https://github.com/orgs/textlint/discussions/2).

The [MIT License](LICENSE) from the upstream repository continues to be honored and upheld.
