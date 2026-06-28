import { defineConfig } from "@rspack/cli";
import path from "node:path";

const config = defineConfig({
  target: "node",
  output: {
    path: path.resolve(__dirname, "dist"),
    library: {
      type: "commonjs",
    },
  },
  stats: {
    errorDetails: true,
  },
  devtool: "source-map",
  externalsType: "commonjs",
  externals: [
    {
      vscode: "vscode",
      textlint: "textlint",
    },
  ],
  resolve: {
    extensions: [".ts", ".js"],
    modules: [path.resolve(__dirname, "node_modules"), "node_modules"],
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
