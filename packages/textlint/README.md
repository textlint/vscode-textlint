# VS Code textlint extension

Integrates [textlint](https://textlint.github.io/) into VS Code. If you are new to textlint check the [documentation](https://textlint.github.io/).

![hover](https://github.com/textlint/vscode-textlint/raw/main/imgs/hover.png?raw=true)

![codeaction](https://github.com/textlint/vscode-textlint/raw/main/imgs/codeaction.png?raw=true)

The extension uses the textlint library installed in the opened workspace folder. If the folder doesn't provide one the extension looks for a global install version. If you haven't installed textlint either locally or globally do so by running `npm install textlint` in the workspace folder for a local install or `npm install -g textlint` for a global install.

On new folders you might also need to create a `.textlintrc` configuration file. You can do this by either running [`textlint --init`](https://github.com/textlint/textlint/blob/master/docs/getting-started.md#configuration) in a terminal or by using the VS Code command `Create '.textlintrc' file`.

## Settings Options

- `textlint.autoFixOnSave`
  - by default is `false`. if you set `true`, Automatically fix auto-fixable errors on save.
- `textlint.run`
  - run the linter `onSave` or `onType`, default is `onType`.
- `textlint.nodePath`
  - use this setting if an installed textlint package can't be detected, for example `/myGlobalNodePackages/node_modules`.
- `textlint.trace`
  - Traces the communication between VS Code and the textlint linter service.
- `textlint.configPath`
  - absolute path to textlint config file.
  - workspace settings are prioritize.
- `textlint.ignorePath`
  - absolute path to textlint ignore file.
  - see [here](https://textlint.github.io/docs/ignore.html#ignoring-files-textlintignore) for ignore file.
- `textlint.targetPath`
  - set a glob pattern.
- `textlint.languages`
  - Languages to lint with textlint.

## Commands

This extension contributes the following commands to the Command palette.

- Create '.textlintrc' File
  - Creates a new `.textlintrc` file.
- Fix all auto-fixable Problems
  - Applies textlint auto-fix resolutions to all fixable problems.

## Release Notes

### 0.12.0

- Change notification level from `ERROR` to `WARN` when executable file is not found ([#6](https://github.com/textlint/vscode-textlint/pull/6))
  - Thanks to @azu
- Improve `.textlintignore` support using `linter.scanFilePath()` API ([#7](https://github.com/textlint/vscode-textlint/pull/7))
  - Thanks to @frozenbonito
- Enable to emit activation events on all language files ([#8](https://github.com/textlint/vscode-textlint/pull/8))
  - Thanks to @iku12phycho

### 0.11.0

- Fix highlight range issue
  - Thanks to @Yuiki

### 0.10.0

- Add VS Code workspace support
- Prepare for web-extension

### 0.9.0

- Add `.textlintignore` support
  - Thanks to @frozenbonito

### 0.8.0

- Add option to choose languages and improve positioning of highlighted
  - Thanks to @linhtto

### 0.7.0

- Add sets a target path support
  - Thanks to @bells17

### 0.6.8

- Change default value of `textlint.run` to `onSave`
- Run tests on Azure Pipelines

### 0.6.5

- Add tex file support including `.tex`, `.latex`, `.doctex`
  - This feature works with [LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop) and [textlint-plugin-latex2e](https://github.com/ta2gch/textlint-plugin-latex2e)

### 0.5.0

- Add `configPath` to configuration. Recommend to use your user settings

### 0.4.0

- Read configuration file from `HOME` dir
  - If you want to use global configuration, you should install textlint and plugins globally

### 0.3.0

- Update runtime dependencies

### 0.2.3

- Add tracing option

### 0.2.2

- Fix some bug

### 0.2.1

- Add progress notification to StatusBar

### 0.2.0

- Add support for fixing errors

### 0.1.0

- Initial Release
