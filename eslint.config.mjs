// @ts-check

import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import { defineConfig, includeIgnoreFile } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier/flat";

const gitignorePath = fileURLToPath(new URL(".gitignore", import.meta.url));

export default defineConfig([
  includeIgnoreFile(gitignorePath, { gitignoreResolution: true }),
  {
    files: ["src/**/*.{js,ts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
      ecmaVersion: 2022,
      sourceType: "module",
    },

    rules: {
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
      ],
      "@typescript-eslint/no-namespace": "warn",

      "no-console": "error",
      curly: "warn",
      eqeqeq: "error",
      "no-throw-literal": "warn",
    },
  },
  {
    files: ["src/test/**/*.ts"],
    rules: {
      "no-console": ["error", { allow: ["error"] }],
    },
  },
  eslintConfigPrettier,
]);
