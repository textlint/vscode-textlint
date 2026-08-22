import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
    nursery: "error",
    pedantic: "error",
    perf: "error",
    suspicious: "error",
  },
  env: {
    node: true,
  },
  ignorePatterns: ["tests/fixtures/**"],
  rules: {
    "max-lines": "warn",
    "max-lines-per-function": "warn",
    "prefer-promise-reject-errors": "warn",
    "typescript/prefer-promise-reject-errors": "warn",
    "typescript/prefer-readonly-parameter-types": "off",
  },
});
