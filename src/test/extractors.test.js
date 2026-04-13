"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { getAgs4References, loadReferences, resolveAgs4ReferenceEdition } = require("../references/extractors");

test("reference extraction reads AGS3 and AGS4 source data", () => {
  const references = loadReferences(path.resolve(__dirname, "../.."));
  const rawReferences = loadReferences(path.resolve(__dirname, "../.."), { preferGenerated: false });
  const ags42 = getAgs4References(references, "4.2");

  assert.equal(references.ags3.stats.groups, 52);
  assert.equal(references.ags3.stats.headings, 697);
  assert.equal(references.ags3.stats.optionalGroups, 10);
  assert.equal(references.ags3.stats.optionalHeadings, 168);
  assert.equal(references.ags4.latestEdition, "4.2");
  assert.deepEqual(Object.keys(references.ags4.byEdition), ["4.0.3", "4.0.4", "4.1", "4.1.1", "4.2"]);
  assert.equal(references.ags4.byEdition["4.0.3"].stats.groups, 124);
  assert.equal(references.ags4.byEdition["4.0.4"].stats.headings, 2101);
  assert.equal(references.ags4.byEdition["4.1"].stats.groups, 148);
  assert.equal(references.ags4.byEdition["4.1.1"].stats.headings, 2895);
  assert.equal(ags42.stats.groups, 171);
  assert.equal(ags42.stats.headings, 3412);
  assert.equal(getAgs4References(rawReferences, "4.2").stats.headings, 3412);

  assert.equal(references.ags3.groups.get("PROJ").description, "Project Information");
  assert.equal(ags42.groups.get("PROJ").description, "Project Information");
  assert.ok(references.ags3.headingsByGroup.get("PROJ").has("PROJ_ID"));
  assert.ok(ags42.headingsByGroup.get("PROJ").has("PROJ_ID"));
});

test("AGS4 edition aliases resolve to bundled dictionaries", () => {
  assert.equal(resolveAgs4ReferenceEdition("4.0"), "4.0.3");
  assert.equal(resolveAgs4ReferenceEdition("4.1.0"), "4.1");
  assert.equal(resolveAgs4ReferenceEdition("4.2.0"), "4.2");
  assert.equal(resolveAgs4ReferenceEdition("4.3"), "4.2");
});
