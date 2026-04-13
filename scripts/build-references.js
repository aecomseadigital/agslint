"use strict";

const fs = require("fs");
const path = require("path");
const { loadReferences } = require("../src/references/extractors");

const baseDir = path.resolve(__dirname, "..");
const outDir = path.join(baseDir, "generated");

fs.mkdirSync(outDir, { recursive: true });

const references = loadReferences(baseDir, { preferGenerated: false });

const ags3 = {
  groups: Object.fromEntries(references.ags3.groups),
  headingsByGroup: Object.fromEntries(
    Array.from(references.ags3.headingsByGroup.entries()).map(([group, headings]) => [group, Object.fromEntries(headings)])
  ),
  stats: references.ags3.stats,
  keysByGroup: Object.fromEntries(references.ags3Keys.keysByGroup)
};

const ags4 = {
  latestEdition: references.ags4.latestEdition,
  byEdition: Object.fromEntries(
    Object.entries(references.ags4.byEdition).map(([edition, reference]) => [
      edition,
      {
        groups: Object.fromEntries(reference.groups),
        headingsByGroup: Object.fromEntries(
          Array.from(reference.headingsByGroup.entries()).map(([group, headings]) => [group, Object.fromEntries(headings)])
        ),
        stats: reference.stats
      }
    ])
  )
};

fs.writeFileSync(path.join(outDir, "ags3.references.json"), `${JSON.stringify(ags3, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, "ags4.references.json"), `${JSON.stringify(ags4, null, 2)}\n`);

console.log("Wrote generated reference files to", outDir);
