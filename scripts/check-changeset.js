"use strict";

const { execFileSync } = require("node:child_process");

const baseRef = process.env.CHANGESET_BASE_REF;

if (!baseRef) {
  console.error("CHANGESET_BASE_REF is required.");
  process.exit(1);
}

const changedFiles = execFileSync(
  "git",
  ["diff", "--name-only", `${baseRef}...HEAD`],
  { encoding: "utf8" }
)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (changedFiles.length === 0) {
  process.exit(0);
}

const changesetPattern = /^\.changeset\/(?!README\.md$).+\.md$/;
const docsOnlyPatterns = [
  /^README\.md$/,
  /^DIAGNOSTICS\.md$/,
  /^PLANS\.md$/,
  /^RELEASING\.md$/,
  /^LICENSE$/,
  /^\.gitignore$/,
  /^\.vscodeignore$/
];

if (changedFiles.some((file) => changesetPattern.test(file))) {
  process.exit(0);
}

const requiresChangeset = changedFiles.some(
  (file) => !docsOnlyPatterns.some((pattern) => pattern.test(file))
);

if (!requiresChangeset) {
  console.log("Docs-only change detected; skipping changeset requirement.");
  process.exit(0);
}

console.error("Missing changeset for a change that affects code, packaging, or release output.");
console.error("Changed files:");
for (const file of changedFiles) {
  console.error(`- ${file}`);
}
console.error("Run `npm run changeset` and commit the generated .changeset/*.md file.");
process.exit(1);
