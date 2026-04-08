"use strict";

function buildRuleCode(format, ruleId) {
  return `${format}-RULE-${String(ruleId).toUpperCase()}`;
}

function createRuleDiagnostic(format, ruleId, checkId, severity, message, line, column, endColumn, extra = {}) {
  return {
    code: buildRuleCode(format, ruleId),
    ruleId: buildRuleCode(format, ruleId),
    checkId,
    severity,
    message,
    line,
    column: column || 1,
    endColumn: endColumn || (column || 1) + 1,
    ...extra
  };
}

function convertGenericCsvDiagnostic(diagnostic, version) {
  const ruleId = version === "3" ? "9" : "6";
  return createRuleDiagnostic(
    `AGS${version}`,
    ruleId,
    diagnostic.message === "Unterminated quoted field." ? `ags${version}.csv.unterminated` : `ags${version}.csv.delimiter`,
    "error",
    diagnostic.message,
    diagnostic.line,
    diagnostic.column,
    diagnostic.endColumn
  );
}

module.exports = {
  buildRuleCode,
  convertGenericCsvDiagnostic,
  createRuleDiagnostic
};
