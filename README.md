# vscode-textlint

![integration-tests](https://github.com/3w36zj6/vscode-textlint/actions/workflows/integration-tests.yaml/badge.svg)

Extension to integrate [textlint](https://textlint.github.io/) into VSCode.

> [!NOTE]
> This repository is fork of [taichi/vscode-textlint](https://github.com/taichi/vscode-textlint).
>
> The [MIT License](LICENSE) from upstream repository continues to be honored and upheld.

## Development setup

1. open `vscode-textlint.code-workspace` by VS Code
2. run `npm ci` inside the **root** folder
3. hit F5 to build and debug the extension

## How to release

1. run `npm ci` inside the **root** folder
2. run `npm run package` inside the **root** folder
3. run `npx vsce publish --packagePath ./packages/textlint/textlint-*.vsix` inside the **root** folder
