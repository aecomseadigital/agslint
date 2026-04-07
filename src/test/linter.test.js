"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { lintText } = require("../linter/linter");

const baseDir = path.resolve(__dirname, "../..");

test("AGS3 lint detects missing UNITS rows", () => {
  const text = [
    "\"**PROJ\"",
    "\"*PROJ_ID\",\"*PROJ_NAME\"",
    "\"ABC\",\"Project\"",
    "\"**UNIT\"",
    "\"*UNIT_UNIT\",\"*UNIT_DESC\"",
    "\"m\",\"metres\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "3" });
  assert.equal(result.version, "3");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "AGS3-UNITS"));
});

test("AGS4 lint detects TYPE mismatches", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\",\"PROJ_NAME\"",
    "\"UNIT\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\"",
    "\"DATA\",\"121415\",\"AGS Test\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "4" });
  assert.equal(result.version, "4");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "AGS4-TYPE"));
});
