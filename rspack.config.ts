import { defineConfig } from "@rspack/cli";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

const config = defineConfig({
  target: "node",
  output: {
    path: path.resolve(rootDirectory, "dist"),
    module: true,
    library: {
      type: "module",
    },
  },
  stats: {
    errorDetails: true,
  },
  devtool: "source-map",
  externalsType: "module-import",
  externals: [
    {
      vscode: "vscode",
      textlint: "textlint",
    },
  ],
  resolve: {
    extensions: [".ts", "..."],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        loader: "builtin:swc-loader",
        options: {
          detectSyntax: "auto",
        },
      },
    ],
  },
});

const configs = defineConfig([
  {
    ...config,
    entry: "./src/client/extension.ts",
    output: {
      ...config.output,
      filename: "extension.js",
    },
  },
  {
    ...config,
    entry: "./src/server/server.ts",
    output: {
      ...config.output,
      filename: "server.js",
    },
  },
]);

export default defineConfig(configs);
