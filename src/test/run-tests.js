"use strict";

const assert = require("node:assert/strict");
const path = require("path");
const { applyEdits, buildQuickFixes } = require("../codeActions/quickFixes");
const { loadReferences } = require("../references/extractors");
const { lintText } = require("../linter/linter");
const { detectVersion } = require("../detector");
const { parseAgs3 } = require("../parser/ags3Parser");

const baseDir = path.resolve(__dirname, "../..");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  }
}

function getDiagnostic(result, code, predicate = () => true) {
  return result.diagnostics.find((diagnostic) => diagnostic.code === code && predicate(diagnostic));
}

function applyFirstQuickFix(text, result, code, predicate = () => true) {
  const diagnostic = getDiagnostic(result, code, predicate);
  assert.ok(diagnostic, `Expected diagnostic ${code}`);

  const fixes = buildQuickFixes(text, result, diagnostic, { baseDir });
  assert.ok(fixes.length > 0, `Expected quick fix for ${code}`);
  return applyEdits(text, fixes[0].edits);
}

run("reference extraction reads AGS3 and AGS4 source data", () => {
  const references = loadReferences(baseDir);

  assert.equal(references.ags3.stats.groups, 52);
  assert.equal(references.ags3.stats.headings, 697);
  assert.equal(references.ags3.stats.optionalGroups, 10);
  assert.equal(references.ags3.stats.optionalHeadings, 168);
  assert.equal(references.ags4.stats.groups, 171);
  assert.equal(references.ags4.stats.headings, 3412);
  assert.equal(references.ags3.groups.get("PROJ").description, "Project Information");
  assert.equal(references.ags4.groups.get("PROJ").description, "Project Information");
});

run("AGS3 lint detects missing UNITS rows", () => {
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

run("AGS3 duplicate-key check maps ?HOLE_ID to HOLE_ID", () => {
  const text = [
    "\"**PROJ\"",
    "\"*PROJ_ID\",\"*PROJ_NAME\",\"*PROJ_AGS\"",
    "\"<UNITS>\",\"\",\"\",\"\"",
    "\"ABC\",\"Project\",\"3.1\"",
    "\"**UNIT\"",
    "\"*UNIT_UNIT\",\"*UNIT_DESC\"",
    "\"m\",\"metres\"",
    "\"**CNMT\"",
    "\"*HOLE_ID\",\"*SAMP_TOP\",\"*SAMP_REF\",\"*SAMP_TYPE\",\"*SPEC_REF\",\"*SPEC_DPTH\",\"*CNMT_TYPE\",\"*CNMT_TTYP\",\"*CNMT_RESL\",\"*CNMT_UNIT\"",
    "\"<UNITS>\",\"\",\"m\",\"\",\"\",\"m\",\"\",\"\",\"\",\"\"",
    "\"ABH14\",\"3\",\"TW1\",\"TW\",\"1\",\"3\",\"SO3\",\"SOLID\",\"0.23\",\"%\"",
    "\"ABH15/WSP\",\"3\",\"TW1\",\"TW\",\"1\",\"3\",\"SO3\",\"SOLID\",\"0.23\",\"%\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "3" });
  assert.equal(result.version, "3");
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "AGS3-KEY"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "AGS3-KEY-DUP"));
});

run("AGS3 heading rules match optional headings with or without question mark", () => {
  const text = [
    "\"**PROJ\"",
    "\"*PROJ_ID\",\"*PROJ_NAME\",\"*PROJ_AGS\"",
    "\"<UNITS>\",\"\",\"\",\"\"",
    "\"ABC\",\"Project\",\"3.1\"",
    "\"**UNIT\"",
    "\"*UNIT_UNIT\",\"*UNIT_DESC\"",
    "\"m\",\"metres\"",
    "\"%\",\"percent\"",
    "\"**CODE\"",
    "\"*CODE_CODE\",\"*CODE_DESC\"",
    "\"PHS\",\"pH\"",
    "\"**CNMT\"",
    "\"*HOLE_ID\",\"*SAMP_TOP\",\"*SAMP_REF\",\"*SAMP_TYPE\",\"*SPEC_REF\",\"*SPEC_DPTH\",\"*CNMT_TYPE\",\"*CNMT_TTYP\",\"*CNMT_RESL\",\"*CNMT_UNIT\",\"*CNMT_ULIM\"",
    "\"<UNITS>\",\"\",\"m\",\"\",\"\",\"m\",\"\",\"\",\"\",\"\",\"%\"",
    "\"ABH14\",\"3\",\"TW1\",\"TW\",\"1\",\"3\",\"SO3\",\"SOLID\",\"0.23\",\"%\",\"0.50\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "3" });
  assert.equal(result.version, "3");
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "AGS3-HEADING"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "AGS3-CUSTOM-HEADING"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "AGS3-DICT"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "AGS3-HEADING-STANDARD" && diagnostic.message.includes('"?CNMT_ULIM"')));
});

run("AGS3 multi-line heading row does not add a phantom extra heading", () => {
  const text = [
    "\"**PROJ\"",
    "\"*PROJ_ID\",\"*PROJ_NAME\",",
    "\"*PROJ_DATE\",\"*PROJ_AGS\"",
    "\"<UNITS>\",\"\",\"dd/mm/yyyy\",\"\"",
    "\"ABC\",\"Project\",\"01/01/2020\",\"3.1\"",
    "\"**UNIT\"",
    "\"*UNIT_UNIT\",\"*UNIT_DESC\"",
    "\"m\",\"metres\""
  ].join("\n");

  const doc = parseAgs3(text);
  const projBlock = doc.blocks.find((block) => block.groupCode === "PROJ");
  assert.ok(projBlock);
  assert.deepEqual(projBlock.headingCodes, ["PROJ_ID", "PROJ_NAME", "PROJ_DATE", "PROJ_AGS"]);

  const result = lintText(text, { baseDir, version: "3" });
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "AGS3-COLUMNS"));
});

run("AGS3 parser reparses continued heading rows from joined raw text", () => {
  const text = [
    "\"**PROJ\"",
    "\"*PROJ_ID\",\"*PROJ_NAME\",",
    "\"*PROJ_DATE\",\"*PROJ_AGS\"",
    "\"<UNITS>\",\"\",\"dd/mm/yyyy\",\"\"",
    "\"ABC\",\"Project\",\"01/01/2020\",\"3.1\"",
    "\"**UNIT\"",
    "\"*UNIT_UNIT\",\"*UNIT_DESC\"",
    "\"m\",\"metres\""
  ].join("\n");

  const doc = parseAgs3(text);
  const projBlock = doc.blocks.find((block) => block.groupCode === "PROJ");
  assert.ok(projBlock);
  assert.equal(projBlock.headingRow.cells.length, 4);
  assert.equal(projBlock.unitsRow.cells.length, 4);
});

run("AGS3 suppresses AGS-CSV and AGS-QUOTE on continued heading rows", () => {
  const text = [
    "\"**CONG\"",
    "\"*HOLE_ID\",\"*SAMP_TOP\",\"*SAMP_REF\",\"*SAMP_TYPE\",\"*SPEC_REF\",\"*SPEC_DPTH\",\"*CONG_TYPE\",\"*CONG_COND\",\"*CONG_REM\",\"*CONG_INCM\",\"*CONG_INCD\",\"*CONG_DIA\",\"*CONG_HIGT\",\"*CONG_MCI\",\"*CONG_MCF\",\"*CONG_BDEN\",\"*CONG_DDEN\",\"*CONG_SATR\",\"*?CONG_IVR\",\"",
    "*?CONG_COM\",\"*?CONG_PRCP\"",
    "\"<UNITS>\",\"m\",\"\",\"\",\"\",\"m\",\"\",\"\",\"\",\"m2/MN\",\"kN/m2\",\"mm\",\"mm\",\"%\",\"%\",\"Mg/m3\",\"Mg/m3\",\"%\",\"\",\"\",\"kPa\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "3" });
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "AGS-CSV"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "AGS-QUOTE"));
});

run("AGS3 invalid split heading emits dedicated continuation errors", () => {
  const text = [
    "\"**CONG\"",
    "\"*HOLE_ID\",\"*SAMP_TOP\",\"*SAMP_REF\",\"*SAMP_TYPE\",\"*SPEC_REF\",\"*SPEC_DPTH\",\"*CONG_TYPE\",\"*CONG_COND\",\"*CONG_REM\",\"*CONG_INCM\",\"*CONG_INCD\",\"*CONG_DIA\",\"*CONG_HIGT\",\"*CONG_MCI\",\"*CONG_MCF\",\"*CONG_BDEN\",\"*CONG_DDEN\",\"*CONG_SATR\",\"*?CONG_IVR\",\"",
    "*?CONG_COM\",\"*?CONG_PRCP\"",
    "\"<UNITS>\",\"m\",\"\",\"\",\"\",\"m\",\"\",\"\",\"\",\"m2/MN\",\"kN/m2\",\"mm\",\"mm\",\"%\",\"%\",\"Mg/m3\",\"Mg/m3\",\"%\",\"\",\"\",\"kPa\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "3" });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "AGS3-HEADING-CONT"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "AGS-CSV"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "AGS-QUOTE"));
});

run("AGS4 lint detects TYPE mismatches", () => {
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

run("AGS4 lint detects missing required headings from DICT_STAT", () => {
  const text = [
    "\"GROUP\",\"TRAN\"",
    "\"HEADING\",\"TRAN_ISNO\"",
    "\"UNIT\",\"\"",
    "\"TYPE\",\"X\"",
    "\"DATA\",\"1\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "4" });
  assert.equal(result.version, "4");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "AGS4-REQUIRED"));
});

run("quick fix wraps unquoted values in double quotes", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\"",
    "\"TYPE\",\"ID\"",
    "\"DATA\",ABC"
  ].join("\n");

  const result = lintText(text, { baseDir, version: "4" });
  const fixed = applyFirstQuickFix(text, result, "AGS-QUOTE");
  assert.equal(fixed.split("\n")[3], "\"DATA\",\"ABC\"");
});

run("quick fix replaces whitespace-only quoted values with empty quotes", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\"",
    "\"TYPE\",\"ID\"",
    "\"DATA\",\"   \""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "4" });
  const fixed = applyFirstQuickFix(text, result, "AGS-EMPTY");
  assert.equal(fixed.split("\n")[3], "\"DATA\",\"\"");
});

run("quick fix replaces a bad AGS3 UNITS first cell", () => {
  const text = [
    "\"**GEOL\"",
    "\"*HOLE_ID\",\"*GEOL_TOP\",\"*GEOL_BASE\"",
    "\"UNITS\",\"m\",\"m\"",
    "\"BH1\",\"1\",\"2\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "3" });
  const fixes = buildQuickFixes(text, result, {
    code: "AGS3-UNITS",
    message: "AGS3 unit rows must start with \"<UNITS>\".",
    line: 3,
    column: 1,
    endColumn: 8
  }, { baseDir });
  assert.ok(fixes.length > 0);
  const fixed = applyEdits(text, fixes[0].edits);
  assert.equal(fixed.split("\n")[2], "\"<UNITS>\",\"m\",\"m\"");
});

run("quick fix inserts a missing AGS3 UNITS row from reference units", () => {
  const text = [
    "\"**GEOL\"",
    "\"*HOLE_ID\",\"*GEOL_TOP\",\"*GEOL_BASE\"",
    "\"BH1\",\"1\",\"2\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "3" });
  const fixed = applyFirstQuickFix(text, result, "AGS3-UNITS", (diagnostic) => diagnostic.message.includes("requires a <UNITS> row"));
  assert.deepEqual(fixed.split("\n").slice(0, 3), [
    "\"**GEOL\"",
    "\"*HOLE_ID\",\"*GEOL_TOP\",\"*GEOL_BASE\"",
    "\"<UNITS>\",\"m\",\"m\""
  ]);
});

run("quick fix replaces a continuation row first cell with <CONT>", () => {
  const text = [
    "\"**GEOL\"",
    "\"*HOLE_ID\",\"*GEOL_DESC\"",
    "\"<UNITS>\",\"\"",
    "\"WRONG\",\"continued text\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "3" });
  const fixes = buildQuickFixes(text, result, {
    code: "AGS3-CONT",
    message: "AGS3 data continuation rows must begin with \"<CONT>\".",
    line: 4,
    column: 1,
    endColumn: 2
  }, { baseDir });
  assert.ok(fixes.length > 0);
  const fixed = applyEdits(text, fixes[0].edits);
  assert.equal(fixed.split("\n")[3], "\"<CONT>\",\"continued text\"");
});

run("quick fix replaces AGS3 headings with the canonical standard heading", () => {
  const text = [
    "\"**PROJ\"",
    "\"*PROJ_ID\",\"*PROJ_NAME\",\"*PROJ_AGS\"",
    "\"<UNITS>\",\"\",\"\",\"\"",
    "\"ABC\",\"Project\",\"3.1\"",
    "\"**UNIT\"",
    "\"*UNIT_UNIT\",\"*UNIT_DESC\"",
    "\"m\",\"metres\"",
    "\"%\",\"percent\"",
    "\"**CODE\"",
    "\"*CODE_CODE\",\"*CODE_DESC\"",
    "\"PHS\",\"pH\"",
    "\"**CNMT\"",
    "\"*HOLE_ID\",\"*SAMP_TOP\",\"*SAMP_REF\",\"*SAMP_TYPE\",\"*SPEC_REF\",\"*SPEC_DPTH\",\"*CNMT_TYPE\",\"*CNMT_TTYP\",\"*CNMT_RESL\",\"*CNMT_UNIT\",\"*CNMT_ULIM\"",
    "\"<UNITS>\",\"\",\"m\",\"\",\"\",\"m\",\"\",\"\",\"\",\"\",\"%\"",
    "\"ABH14\",\"3\",\"TW1\",\"TW\",\"1\",\"3\",\"SO3\",\"SOLID\",\"0.23\",\"%\",\"0.50\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "3" });
  const fixed = applyFirstQuickFix(text, result, "AGS3-HEADING-STANDARD");
  assert.ok(fixed.split("\n")[12].includes("\"*?CNMT_ULIM\""));
});

run("quick fix replaces AGS4 TYPE values with the reference data type", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\",\"PROJ_NAME\"",
    "\"UNIT\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\"",
    "\"DATA\",\"121415\",\"AGS Test\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "4" });
  const fixed = applyFirstQuickFix(text, result, "AGS4-TYPE", (diagnostic) => diagnostic.message.includes("does not match"));
  assert.equal(fixed.split("\n")[3], "\"TYPE\",\"ID\",\"X\"");
});

run("quick fix inserts a missing AGS4 TYPE row from reference types", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\",\"PROJ_NAME\"",
    "\"UNIT\",\"\",\"\"",
    "\"DATA\",\"121415\",\"AGS Test\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "4" });
  const fixed = applyFirstQuickFix(text, result, "AGS4-TYPE", (diagnostic) => diagnostic.message.includes("must contain a TYPE row"));
  assert.deepEqual(fixed.split("\n").slice(0, 4), [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\",\"PROJ_NAME\"",
    "\"UNIT\",\"\",\"\"",
    "\"TYPE\",\"ID\",\"X\""
  ]);
});

run("detector reads AGS3 edition from PROJ_AGS", () => {
  const text = [
    "\"**PROJ\"",
    "\"*PROJ_ID\",\"*PROJ_NAME\",\"*PROJ_AGS\"",
    "\"<UNITS>\",\"\",\"\",\"\"",
    "\"ABC\",\"Project\",\"3.1\""
  ].join("\n");

  const detected = detectVersion(text);
  assert.equal(detected.version, "3");
  assert.equal(detected.edition, "3.1");
  assert.equal(detected.source, "PROJ_AGS");
});

run("detector reads AGS4 edition from TRAN_AGS", () => {
  const text = [
    "\"GROUP\",\"TRAN\"",
    "\"HEADING\",\"TRAN_ISNO\",\"TRAN_AGS\"",
    "\"UNIT\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\"",
    "\"DATA\",\"1\",\"4.2.0\""
  ].join("\n");

  const detected = detectVersion(text);
  assert.equal(detected.version, "4");
  assert.equal(detected.edition, "4.2.0");
  assert.equal(detected.source, "TRAN_AGS");
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
