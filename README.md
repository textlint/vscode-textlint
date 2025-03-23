# vscode-textlint

![integration-tests](https://github.com/textlint/vscode-textlint/actions/workflows/integration-tests.yaml/badge.svg)

Extension to integrate [textlint](https://textlint.github.io/) into VSCode.

## Development setup

1. open `vscode-textlint.code-workspace` by VS Code
2. run `npm ci` inside the **root** folder
3. hit F5 to build and debug the extension

## How to release

1. run `npm ci` inside the **root** folder
2. run `npm run package` inside the **root** folder
3. run `npx vsce publish --packagePath ./packages/textlint/textlint-*.vsix` inside the **root** folder

## Acknowledgements

This project was originally created as [taichi/vscode-textlint](https://github.com/taichi/vscode-textlint). It has been transferred to the textlint organization since [v0.12.0](https://github.com/textlint/vscode-textlint/releases/tag/v0.12.0) for continued maintenance and development. We'd like to express our gratitude to [@taichi](https://github.com/taichi) and all contributors. For more details, please see [github.com/orgs/textlint/discussions/2](https://github.com/orgs/textlint/discussions/2).

The [MIT License](LICENSE) from the upstream repository continues to be honored and upheld.
