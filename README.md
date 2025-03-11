# vscode-textlint ![push](https://github.com/3w36zj6/vscode-textlint/actions/workflows/push.yml/badge.svg)

Extension to integrate [textlint](https://textlint.github.io/) into VSCode.

> [!NOTE]
> This repository is fork of [taichi/vscode-textlint](https://github.com/taichi/vscode-textlint).
> 
> The [MIT License](LICENSE) from upstream repository continues to be honored and upheld.

## Development setup

- open `vscode-textlint.code-workspace` by VS Code
- run `npm install` inside the **root** folder
- hit F5 to build and debug the extension

## How to release

1. run `npm upgrade` inside the **root** folder
2. run `npm install` inside the **root** folder
3. run `vsce publish` inside the **packages/textlint** folder
