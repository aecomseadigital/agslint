"use strict";

const fs = require("node:fs");
const path = require("node:path");

const baseDir = path.resolve(__dirname, "..");
const changelogPath = path.join(baseDir, "CHANGELOG.md");
const version = process.argv[2] || require(path.join(baseDir, "package.json")).version;
const outputPath = process.argv[3] || null;
const changelog = fs.readFileSync(changelogPath, "utf8").replace(/^\uFEFF/, "");
const normalized = changelog.replace(/\r\n/g, "\n");

function parseSections(text) {
  const sectionPattern = /^##\s+([0-9]+\.[0-9]+\.[0-9]+)\s*$/gm;
  const headings = [];
  let match;

  while ((match = sectionPattern.exec(text)) !== null) {
    headings.push({
      version: match[1],
      start: match.index,
      length: match[0].length
    });
  }

  return headings.map((heading, index) => {
    const next = headings[index + 1];
    const bodyStart = heading.start + heading.length;
    const bodyEnd = next ? next.start : text.length;
    return {
      version: heading.version,
      body: text.slice(bodyStart, bodyEnd).replace(/^\n+/, "").trim()
    };
  });
}

const sections = parseSections(normalized);
const currentSection = sections.find((section) => section.version === version);

if (!currentSection) {
  const available = sections.map((section) => section.version).join(", ") || "none";
  console.error(`Could not find CHANGELOG entry for version ${version}. Available versions: ${available}`);
  process.exit(1);
}

const notes = `# AGSLint v${version}\n\n${currentSection.body}\n`;

if (outputPath) {
  fs.writeFileSync(path.resolve(baseDir, outputPath), notes, "utf8");
  console.log(`Wrote ${outputPath}`);
} else {
  process.stdout.write(notes);
}
