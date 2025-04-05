# VS Code textlint extension

Integrates [textlint](https://textlint.github.io/) into VS Code. If you are new to textlint, check the [documentation](https://textlint.github.io/).

![hover](https://github.com/textlint/vscode-textlint/raw/main/imgs/hover.png?raw=true)

![codeaction](https://github.com/textlint/vscode-textlint/raw/main/imgs/codeaction.png?raw=true)

The extension uses the textlint library installed in the opened workspace folder. If the folder doesn't provide one, the extension looks for a global install version. If you haven't installed textlint either locally or globally, you can do so by running `npm install textlint` in the workspace folder for a local install or `npm install -g textlint` for a global install.

When working with new projects, you might need to create a `.textlintrc` configuration file. You can do this by either running [`textlint --init`](https://github.com/textlint/textlint/blob/master/docs/getting-started.md#configuration) in a terminal or by using the VS Code command `Create '.textlintrc' file`.

## Settings options

- `textlint.autoFixOnSave`
  - Default: `false`. When set to `true`, the extension will automatically fix auto-fixable errors on save.
- `textlint.run`
  - Controls when the linter runs. Options: `onSave` or `onType`. Default: `onType`.
- `textlint.nodePath`
  - Use this setting if an installed textlint package can't be detected, for example `/myGlobalNodePackages/node_modules`.
- `textlint.trace`
  - Traces the communication between VS Code and the textlint linter service.
- `textlint.configPath`
  - Absolute path to textlint config file.
  - Workspace settings take priority over this setting.
- `textlint.ignorePath`
  - Absolute path to textlint ignore file.
  - See [here](https://textlint.github.io/docs/ignore.html#ignoring-files-textlintignore) for more information about ignore files.
- `textlint.targetPath`
  - Set a glob pattern to determine which files to lint.
- `textlint.languages`
  - Languages to lint with textlint.

## Commands

This extension contributes the following commands to the Command palette:

- Create '.textlintrc' File
  - Creates a new `.textlintrc` configuration file in your workspace.
- Fix all auto-fixable Problems
  - Applies textlint auto-fix resolutions to all fixable problems in the current document.

## Release notes

### 0.12.0

- Changed notification level from `ERROR` to `WARN` when executable file is not found ([#6](https://github.com/textlint/vscode-textlint/pull/6))
  - Thanks to @azu
- Improved `.textlintignore` support using `linter.scanFilePath()` API ([#7](https://github.com/textlint/vscode-textlint/pull/7))
  - Thanks to @frozenbonito
- Enabled to emit activation events on all language files ([#8](https://github.com/textlint/vscode-textlint/pull/8))
  - Thanks to @iku12phycho

### 0.11.0

- Fixed highlight range issue
  - Thanks to @Yuiki

### 0.10.0

- Added VS Code workspace support
- Prepared for web-extension

### 0.9.0

- Added `.textlintignore` support
  - Thanks to @frozenbonito

### 0.8.0

- Added option to choose languages and improved positioning of highlighted text
  - Thanks to @linhtto

### 0.7.0

- Added target path support
  - Thanks to @bells17

### 0.6.8

- Changed default value of `textlint.run` to `onSave`
- Added Azure Pipelines for CI testing

### 0.6.5

- Added tex file support including `.tex`, `.latex`, `.doctex`
  - This feature works with [LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop) and [textlint-plugin-latex2e](https://github.com/ta2gch/textlint-plugin-latex2e)

### 0.5.0

- Added `configPath` to configuration. Recommend to use your user settings

### 0.4.0

- Added ability to read configuration file from `HOME` directory
  - If you want to use global configuration, you should install textlint and plugins globally

### 0.3.0

- Updated runtime dependencies

### 0.2.3

- Added a tracing option

### 0.2.2

- Fixed various bugs

### 0.2.1

- Added progress notification to StatusBar

### 0.2.0

- Added support for fixing errors

### 0.1.0

- Initial Release
