"use strict";

const webpack = require("webpack");
const path = require("path");
const extensionPackage = require("./packages/textlint/package.json");
const merge = require("merge-options");

/**@type {import('webpack').Configuration}*/
const config = {
  target: "node",
  output: {
    path: path.resolve(__dirname, "packages/textlint/dist"),
    libraryTarget: "commonjs",
  },
  stats: {
    errorDetails: true,
  },
  devtool: "source-map",
  externals: [
    {
      vscode: "commonjs vscode",
      textlint: "commonjs textlint",
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
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
};

/**@type {import('webpack').Configuration}*/
const client = merge(config, {
  entry: "./packages/textlint/src/extension.ts",
  output: {
    filename: "extension.js",
  },
  plugins: [
    new webpack.EnvironmentPlugin({
      EXTENSION_NAME: `${extensionPackage.publisher}.${extensionPackage.name}`,
      EXTENSION_VERSION: extensionPackage.version,
    }),
  ],
});

/**@type {import('webpack').Configuration}*/
const server = merge(config, {
  entry: "./packages/textlint-server/src/server.ts",
  output: {
    filename: "server.js",
  },
});

module.exports = [client, server];
