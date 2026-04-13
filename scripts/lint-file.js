"use strict";

const path = require("path");
const { lintFile } = require("../src/linter/linter");

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: npm run lint-file -- <path-to-file>");
  process.exit(1);
}

const result = lintFile(path.resolve(process.cwd(), filePath), {
  baseDir: path.resolve(__dirname, "..")
});

const referenceText = result.referenceEdition ? ` using dictionary ${result.referenceEdition}` : "";
console.log(`Detected AGS ${result.version}${referenceText}`);

if (!result.diagnostics.length) {
  console.log("No diagnostics.");
  process.exit(0);
}

for (const diagnostic of result.diagnostics) {
  const severity = (diagnostic.severity || "info").toUpperCase();
  console.log(`${severity} ${diagnostic.code} ${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`);
}

process.exit(result.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 1 : 0);
