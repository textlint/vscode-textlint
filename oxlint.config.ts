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
    "typescript/prefer-readonly-parameter-types": "off",
  },
});
