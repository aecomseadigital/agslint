"use strict";

const fs = require("node:fs");
const path = require("node:path");

const baseDir = path.resolve(__dirname, "..");
const changelogPath = path.join(baseDir, "CHANGELOG.md");
const version = process.argv[2] || require(path.join(baseDir, "package.json")).version;
const outputPath = process.argv[3] || null;
const changelog = fs.readFileSync(changelogPath, "utf8");
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const headingPattern = new RegExp(`^## ${escapedVersion}\\s*$`, "m");
const headingMatch = changelog.match(headingPattern);

if (!headingMatch || typeof headingMatch.index !== "number") {
  console.error(`Could not find CHANGELOG entry for version ${version}`);
  process.exit(1);
}

const sectionStart = headingMatch.index + headingMatch[0].length;
const sectionBody = changelog.slice(sectionStart).replace(/^\r?\n/, "");
const nextHeadingIndex = sectionBody.search(/^##\s+/m);
const section = nextHeadingIndex === -1
  ? sectionBody
  : sectionBody.slice(0, nextHeadingIndex);
const notes = `# AGSLint v${version}\n\n${section.trim()}\n`;

if (outputPath) {
  fs.writeFileSync(path.resolve(baseDir, outputPath), notes, "utf8");
  console.log(`Wrote ${outputPath}`);
} else {
  process.stdout.write(notes);
}
