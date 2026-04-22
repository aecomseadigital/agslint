"use strict";

const assert = require("node:assert/strict");
const path = require("path");
const { applyEdits, buildQuickFixes } = require("../codeActions/quickFixes");
const { getAgs4References, loadReferences, resolveAgs4ReferenceEdition } = require("../references/extractors");
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

function getDiagnostic(result, predicate = () => true) {
  return result.diagnostics.find((diagnostic) => predicate(diagnostic));
}

function applyFirstQuickFix(text, result, predicate, label) {
  const diagnostic = getDiagnostic(result, predicate);
  assert.ok(diagnostic, `Expected diagnostic ${label}`);

  const fixes = buildQuickFixes(text, result, diagnostic, { baseDir });
  assert.ok(fixes.length > 0, `Expected quick fix for ${label}`);
  return applyEdits(text, fixes[0].edits);
}

run("reference extraction reads AGS3 and AGS4 source data", () => {
  const references = loadReferences(baseDir);
  const rawReferences = loadReferences(baseDir, { preferGenerated: false });
  const ags403 = getAgs4References(references, "4.0.3");
  const ags404 = getAgs4References(references, "4.0.4");
  const ags41 = getAgs4References(references, "4.1");
  const ags411 = getAgs4References(references, "4.1.1");
  const ags42 = getAgs4References(references, "4.2");

  assert.equal(references.ags3.stats.groups, 52);
  assert.equal(references.ags3.stats.headings, 697);
  assert.equal(references.ags3.stats.optionalGroups, 10);
  assert.equal(references.ags3.stats.optionalHeadings, 168);
  assert.equal(references.ags4.latestEdition, "4.2");
  assert.deepEqual(Object.keys(references.ags4.byEdition), ["4.0.3", "4.0.4", "4.1", "4.1.1", "4.2"]);
  assert.equal(ags403.stats.groups, 124);
  assert.equal(ags403.stats.headings, 2093);
  assert.equal(ags404.stats.groups, 124);
  assert.equal(ags404.stats.headings, 2101);
  assert.equal(ags41.stats.groups, 148);
  assert.equal(ags41.stats.headings, 2898);
  assert.equal(ags411.stats.groups, 148);
  assert.equal(ags411.stats.headings, 2895);
  assert.equal(ags42.stats.groups, 171);
  assert.equal(ags42.stats.headings, 3412);
  assert.equal(getAgs4References(rawReferences, "4.2").stats.headings, 3412);
  assert.equal(references.ags3.groups.get("PROJ").description, "Project Information");
  assert.equal(ags42.groups.get("PROJ").description, "Project Information");
});

run("AGS4 reference edition aliases resolve deterministically", () => {
  assert.equal(resolveAgs4ReferenceEdition("4.0"), "4.0.3");
  assert.equal(resolveAgs4ReferenceEdition("4.0.0"), "4.0.3");
  assert.equal(resolveAgs4ReferenceEdition("4.0.4"), "4.0.4");
  assert.equal(resolveAgs4ReferenceEdition("4.1"), "4.1");
  assert.equal(resolveAgs4ReferenceEdition("4.1.0"), "4.1");
  assert.equal(resolveAgs4ReferenceEdition("4.1.1"), "4.1.1");
  assert.equal(resolveAgs4ReferenceEdition("4.2"), "4.2");
  assert.equal(resolveAgs4ReferenceEdition("4.2.0"), "4.2");
  assert.equal(resolveAgs4ReferenceEdition(null), "4.2");
  assert.equal(resolveAgs4ReferenceEdition("4.3"), "4.2");
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
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.units.missing"));
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
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.key.missing"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.key.duplicate"));
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
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.heading.unknown"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.heading.custom-pattern"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.group.dict-missing"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.heading.standard" && diagnostic.message.includes('"?CNMT_ULIM"')));
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
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.data.columns"));
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
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.csv.unterminated" || diagnostic.checkId === "ags3.csv.delimiter"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.quote.unquoted"));
});

run("AGS3 invalid split heading emits dedicated continuation errors", () => {
  const text = [
    "\"**CONG\"",
    "\"*HOLE_ID\",\"*SAMP_TOP\",\"*SAMP_REF\",\"*SAMP_TYPE\",\"*SPEC_REF\",\"*SPEC_DPTH\",\"*CONG_TYPE\",\"*CONG_COND\",\"*CONG_REM\",\"*CONG_INCM\",\"*CONG_INCD\",\"*CONG_DIA\",\"*CONG_HIGT\",\"*CONG_MCI\",\"*CONG_MCF\",\"*CONG_BDEN\",\"*CONG_DDEN\",\"*CONG_SATR\",\"*?CONG_IVR\",\"",
    "*?CONG_COM\",\"*?CONG_PRCP\"",
    "\"<UNITS>\",\"m\",\"\",\"\",\"\",\"m\",\"\",\"\",\"\",\"m2/MN\",\"kN/m2\",\"mm\",\"mm\",\"%\",\"%\",\"Mg/m3\",\"Mg/m3\",\"%\",\"\",\"\",\"kPa\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "3" });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "AGS3-RULE-13"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.csv.unterminated" || diagnostic.checkId === "ags3.csv.delimiter"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags3.quote.unquoted"));
});

run("AGS4 lint detects TYPE mismatches", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\",\"PROJ_NAME\"",
    "\"UNIT\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\"",
    "\"DATA\",\"121415\",\"AGS Test\""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  assert.equal(result.version, "4");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.type.reference-mismatch" && diagnostic.severity === "warning"));
});

run("AGS4 lint reports data type validation as warnings", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\"",
    "\"UNIT\",\"\"",
    "\"TYPE\",\"2DP\"",
    "\"DATA\",\"1.2\""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.type.value-invalid" && diagnostic.severity === "warning"));
});

run("AGS4 lint detects missing required headings from DICT_STAT", () => {
  const text = [
    "\"GROUP\",\"TRAN\"",
    "\"HEADING\",\"TRAN_ISNO\"",
    "\"UNIT\",\"\"",
    "\"TYPE\",\"X\"",
    "\"DATA\",\"1\""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  assert.equal(result.version, "4");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.required.missing-heading"));
});

run("AGS4 lint detects misplaced duplicate structural rows", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\",\"PROJ_NAME\"",
    "\"UNIT\",\"\",\"\"",
    "\"UNIT\",\"\",\"\"",
    "\"TYPE\",\"ID\",\"X\"",
    "\"DATA\",\"121415\",\"AGS Test\""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.unit.duplicate-row"));
});

run("AGS4 lint detects duplicate key combinations", () => {
  const text = [
    "\"GROUP\",\"ABBR\"",
    "\"HEADING\",\"ABBR_HDNG\",\"ABBR_CODE\",\"ABBR_DESC\"",
    "\"UNIT\",\"\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\",\"X\"",
    "\"DATA\",\"LOCA_TYPE\",\"TP\",\"Trial Pit\"",
    "\"DATA\",\"LOCA_TYPE\",\"TP\",\"Trial Pit Duplicate\""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.key.duplicate"));
});

run("AGS4 lint merges in-file DICT definitions for custom groups and headings", () => {
  const text = [
    "\"GROUP\",\"DICT\"",
    "\"HEADING\",\"DICT_TYPE\",\"DICT_GRP\",\"DICT_HDNG\",\"DICT_STAT\",\"DICT_DTYP\",\"DICT_DESC\",\"DICT_UNIT\",\"DICT_PGRP\"",
    "\"UNIT\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\"",
    "\"TYPE\",\"PA\",\"X\",\"X\",\"PA\",\"PT\",\"X\",\"PU\",\"X\"",
    "\"DATA\",\"GROUP\",\"NGRP\",\"\",\"\",\"\",\"New Group\",\"\",\"-\"",
    "\"DATA\",\"HEADING\",\"NGRP\",\"NGRP_VAL\",\"OTHER\",\"X\",\"New Value\",\"\",\"\"",
    "\"GROUP\",\"NGRP\"",
    "\"HEADING\",\"NGRP_VAL\"",
    "\"UNIT\",\"\"",
    "\"TYPE\",\"X\"",
    "\"DATA\",\"Hello\""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.group.unknown"));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.heading.unknown"));
});

run("AGS4 lint detects FILE_FSET usage without FILE group", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\",\"PROJ_NAME\",\"FILE_FSET\"",
    "\"UNIT\",\"\",\"\",\"\"",
    "\"TYPE\",\"ID\",\"X\",\"X\"",
    "\"DATA\",\"121415\",\"AGS Test\",\"FS1\""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.file.group-missing"));
});

run("AGS4 lint selects the 4.2 dictionary for 4.2-only groups", () => {
  const text = [
    "\"GROUP\",\"TRAN\"",
    "\"HEADING\",\"TRAN_ISNO\",\"TRAN_AGS\",\"TRAN_DLIM\",\"TRAN_RCON\"",
    "\"UNIT\",\"\",\"\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\",\"X\",\"X\"",
    "\"DATA\",\"1\",\"4.2.0\",\",\",\";\"",
    "\"GROUP\",\"CPTT\"",
    "\"HEADING\",\"LOCA_ID\",\"CPTG_TESN\",\"CPTT_REDN\"",
    "\"UNIT\",\"\",\"\",\"\"",
    "\"TYPE\",\"ID\",\"X\",\"0DP\"",
    "\"DATA\",\"LOC1\",\"TEST1\",\"1\""
  ].join("\r\n");

  const result = lintText(text, { baseDir });
  assert.equal(result.referenceEdition, "4.2");
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.group.unknown" && diagnostic.message.includes("\"CPTT\"")));
});

run("AGS4 lint flags 4.2-only groups when a 4.1.1 dictionary is selected", () => {
  const text = [
    "\"GROUP\",\"TRAN\"",
    "\"HEADING\",\"TRAN_ISNO\",\"TRAN_AGS\",\"TRAN_DLIM\",\"TRAN_RCON\"",
    "\"UNIT\",\"\",\"\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\",\"X\",\"X\"",
    "\"DATA\",\"1\",\"4.1.1\",\",\",\";\"",
    "\"GROUP\",\"CPTT\"",
    "\"HEADING\",\"LOCA_ID\",\"CPTG_TESN\",\"CPTT_REDN\"",
    "\"UNIT\",\"\",\"\",\"\"",
    "\"TYPE\",\"ID\",\"X\",\"0DP\"",
    "\"DATA\",\"LOC1\",\"TEST1\",\"1\""
  ].join("\r\n");

  const result = lintText(text, { baseDir });
  assert.equal(result.referenceEdition, "4.1.1");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.group.unknown" && diagnostic.message.includes("\"CPTT\"")));
});

run("AGS4 lint selects the 4.1 dictionary for 4.1-era groups", () => {
  const text = [
    "\"GROUP\",\"TRAN\"",
    "\"HEADING\",\"TRAN_ISNO\",\"TRAN_AGS\",\"TRAN_DLIM\",\"TRAN_RCON\"",
    "\"UNIT\",\"\",\"\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\",\"X\",\"X\"",
    "\"DATA\",\"1\",\"4.1\",\",\",\";\"",
    "\"GROUP\",\"CTRC\"",
    "\"HEADING\",\"LOCA_ID\",\"SAMP_TOP\",\"SAMP_REF\",\"SAMP_TYPE\",\"SAMP_ID\",\"SPEC_REF\",\"SPEC_DPTH\",\"CTRC_TESN\"",
    "\"UNIT\",\"\",\"m\",\"\",\"\",\"\",\"\",\"m\",\"\"",
    "\"TYPE\",\"ID\",\"2DP\",\"X\",\"PA\",\"X\",\"X\",\"2DP\",\"X\"",
    "\"DATA\",\"LOC1\",\"1.00\",\"REF1\",\"B\",\"S1\",\"SPEC1\",\"1.00\",\"T1\""
  ].join("\r\n");

  const result = lintText(text, { baseDir });
  assert.equal(result.referenceEdition, "4.1");
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.group.unknown" && diagnostic.message.includes("\"CTRC\"")));
});

run("AGS4 lint flags 4.1-era groups when a 4.0.4 dictionary is selected", () => {
  const text = [
    "\"GROUP\",\"TRAN\"",
    "\"HEADING\",\"TRAN_ISNO\",\"TRAN_AGS\",\"TRAN_DLIM\",\"TRAN_RCON\"",
    "\"UNIT\",\"\",\"\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\",\"X\",\"X\"",
    "\"DATA\",\"1\",\"4.0.4\",\",\",\";\"",
    "\"GROUP\",\"CTRC\"",
    "\"HEADING\",\"LOCA_ID\",\"SAMP_TOP\",\"SAMP_REF\",\"SAMP_TYPE\",\"SAMP_ID\",\"SPEC_REF\",\"SPEC_DPTH\",\"CTRC_TESN\"",
    "\"UNIT\",\"\",\"m\",\"\",\"\",\"\",\"\",\"m\",\"\"",
    "\"TYPE\",\"ID\",\"2DP\",\"X\",\"PA\",\"X\",\"X\",\"2DP\",\"X\"",
    "\"DATA\",\"LOC1\",\"1.00\",\"REF1\",\"B\",\"S1\",\"SPEC1\",\"1.00\",\"T1\""
  ].join("\r\n");

  const result = lintText(text, { baseDir });
  assert.equal(result.referenceEdition, "4.0.4");
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.checkId === "ags4.group.unknown" && diagnostic.message.includes("\"CTRC\"")));
});

run("quick fix wraps unquoted values in double quotes", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\"",
    "\"TYPE\",\"ID\"",
    "\"DATA\",ABC"
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  const fixed = applyFirstQuickFix(text, result, (diagnostic) => diagnostic.checkId === "ags4.quote.unquoted", "ags4.quote.unquoted");
  assert.equal(fixed.split("\r\n")[3], "\"DATA\",\"ABC\"");
});

run("quick fix replaces whitespace-only quoted values with empty quotes", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\"",
    "\"TYPE\",\"ID\"",
    "\"DATA\",\"   \""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  const fixed = applyFirstQuickFix(text, result, (diagnostic) => diagnostic.checkId === "ags4.quote.whitespace", "ags4.quote.whitespace");
  assert.equal(fixed.split("\r\n")[3], "\"DATA\",\"\"");
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
    code: "AGS3-RULE-18",
    checkId: "ags3.units.first-cell",
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
  const fixed = applyFirstQuickFix(text, result, (diagnostic) => diagnostic.checkId === "ags3.units.missing", "ags3.units.missing");
  assert.deepEqual(fixed.split("\n").slice(0, 3), [
    "\"**GEOL\"",
    "\"*HOLE_ID\",\"*GEOL_TOP\",\"*GEOL_BASE\"",
    "\"<UNITS>\",\"m\",\"m\""
  ]);
});

run("quick fix replaces an empty AGS3 unit with the reference unit", () => {
  const text = [
    "\"**SAMP\"",
    "\"*HOLE_ID\",\"*SAMP_TOP\",\"*SAMP_DIA\",\"*SAMP_BASE\"",
    "\"<UNITS>\",\"m\",\"\",\"m\"",
    "\"BH1\",\"1\",\"75\",\"2\""
  ].join("\n");

  const result = lintText(text, { baseDir, version: "3" });
  const diagnostic = getDiagnostic(result, (entry) => entry.checkId === "ags3.units.reference");
  assert.ok(diagnostic);
  assert.match(diagnostic.message, /Suggested fix: replace the empty unit with the AGS3 reference unit "mm"\./);

  const fixed = applyFirstQuickFix(text, result, (entry) => entry.checkId === "ags3.units.reference", "ags3.units.reference");
  assert.equal(fixed.split("\n")[2], "\"<UNITS>\",\"m\",\"mm\",\"m\"");
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
    code: "AGS3-RULE-14",
    checkId: "ags3.cont.first-cell",
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
  const fixed = applyFirstQuickFix(text, result, (diagnostic) => diagnostic.checkId === "ags3.heading.standard", "ags3.heading.standard");
  assert.ok(fixed.split("\n")[12].includes("\"*?CNMT_ULIM\""));
});

run("quick fix replaces AGS4 TYPE values with the reference data type", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\",\"PROJ_NAME\"",
    "\"UNIT\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\"",
    "\"DATA\",\"121415\",\"AGS Test\""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  const fixed = applyFirstQuickFix(text, result, (diagnostic) => diagnostic.checkId === "ags4.type.reference-mismatch", "ags4.type.reference-mismatch");
  assert.equal(fixed.split("\r\n")[3], "\"TYPE\",\"ID\",\"X\"");
});

run("quick fix uses the resolved AGS4 dictionary edition for TYPE replacements", () => {
  const text = [
    "\"GROUP\",\"TRAN\"",
    "\"HEADING\",\"TRAN_ISNO\",\"TRAN_AGS\",\"TRAN_DLIM\",\"TRAN_RCON\"",
    "\"UNIT\",\"\",\"\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\",\"X\",\"X\"",
    "\"DATA\",\"1\",\"4.1.1\",\",\",\";\"",
    "\"GROUP\",\"PMTD\"",
    "\"HEADING\",\"LOCA_ID\",\"PMTD_AX1\"",
    "\"UNIT\",\"\",\"mm\"",
    "\"TYPE\",\"ID\",\"4DP\"",
    "\"DATA\",\"LOC1\",\"1.2345\""
  ].join("\r\n");

  const result = lintText(text, { baseDir });
  assert.equal(result.referenceEdition, "4.1.1");
  const fixed = applyFirstQuickFix(text, result, (diagnostic) => diagnostic.checkId === "ags4.type.reference-mismatch", "ags4.type.reference-mismatch");
  assert.equal(fixed.split("\r\n")[8], "\"TYPE\",\"ID\",\"3DP\"");
});

run("quick fix normalizes AGS4 nDP values to the expected decimal precision", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\"",
    "\"UNIT\",\"\"",
    "\"TYPE\",\"2DP\"",
    "\"DATA\",\"1.2\""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  const fixed = applyFirstQuickFix(text, result, (diagnostic) => diagnostic.checkId === "ags4.type.value-invalid", "ags4.type.value-invalid");
  assert.equal(fixed.split("\r\n")[4], "\"DATA\",\"1.20\"");
});

run("quick fix normalizes AGS4 nSF values to the expected significant figures", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\"",
    "\"UNIT\",\"\"",
    "\"TYPE\",\"2SF\"",
    "\"DATA\",\"1.234\""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  const fixed = applyFirstQuickFix(text, result, (diagnostic) => diagnostic.checkId === "ags4.type.value-invalid", "ags4.type.value-invalid");
  assert.equal(fixed.split("\r\n")[4], "\"DATA\",\"1.2\"");
});

run("quick fix inserts a missing AGS4 TYPE row from reference types", () => {
  const text = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\",\"PROJ_NAME\"",
    "\"UNIT\",\"\",\"\"",
    "\"DATA\",\"121415\",\"AGS Test\""
  ].join("\r\n");

  const result = lintText(text, { baseDir, version: "4" });
  const fixed = applyFirstQuickFix(text, result, (diagnostic) => diagnostic.checkId === "ags4.type.missing-row", "ags4.type.missing-row");
  assert.deepEqual(fixed.split("\r\n").slice(0, 4), [
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

run("AGS4 lint falls back to the latest bundled dictionary when edition is missing or unsupported", () => {
  const missingEditionText = [
    "\"GROUP\",\"PROJ\"",
    "\"HEADING\",\"PROJ_ID\",\"PROJ_NAME\"",
    "\"UNIT\",\"\",\"\"",
    "\"TYPE\",\"ID\",\"X\"",
    "\"DATA\",\"121415\",\"AGS Test\""
  ].join("\r\n");

  const missingEditionResult = lintText(missingEditionText, { baseDir, version: "4" });
  assert.equal(missingEditionResult.referenceEdition, "4.2");

  const unsupportedEditionText = [
    "\"GROUP\",\"TRAN\"",
    "\"HEADING\",\"TRAN_ISNO\",\"TRAN_AGS\",\"TRAN_DLIM\",\"TRAN_RCON\"",
    "\"UNIT\",\"\",\"\",\"\",\"\"",
    "\"TYPE\",\"X\",\"X\",\"X\",\"X\"",
    "\"DATA\",\"1\",\"4.3\",\",\",\";\""
  ].join("\r\n");

  const unsupportedEditionResult = lintText(unsupportedEditionText, { baseDir });
  assert.equal(unsupportedEditionResult.referenceEdition, "4.2");
});

if (process.exitCode) {
  process.exit(process.exitCode);
}
