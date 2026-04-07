"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { loadReferences } = require("../references/extractors");

test("reference extraction reads AGS3 and AGS4 source data", () => {
  const references = loadReferences(path.resolve(__dirname, "../.."));

  assert.equal(references.ags3.stats.groups, 52);
  assert.equal(references.ags3.stats.headings, 697);
  assert.equal(references.ags3.stats.optionalGroups, 10);
  assert.equal(references.ags3.stats.optionalHeadings, 168);
  assert.equal(references.ags4.stats.groups, 171);
  assert.equal(references.ags4.stats.headings, 3412);

  assert.equal(references.ags3.groups.get("PROJ").description, "Project Information");
  assert.equal(references.ags4.groups.get("PROJ").description, "Project Information");
  assert.ok(references.ags3.headingsByGroup.get("PROJ").has("PROJ_ID"));
  assert.ok(references.ags4.headingsByGroup.get("PROJ").has("PROJ_ID"));
});
