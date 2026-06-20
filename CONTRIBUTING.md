# Contributing

## Development setup

1. Open `vscode-textlint.code-workspace` in VS Code.
2. Run `npm ci` in the root folder.
3. Press F5 to build and launch the extension in debug mode.

## Release process

1. Run `npm ci` in the root folder.
2. Run `npm run package` in the root folder.
3. Run `npx vsce publish --packagePath ./textlint-*.vsix` in the root folder.
