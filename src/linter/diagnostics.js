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

// Data-consistency checks are not AGS format rules -- the standard does not
// constrain what a remark may contain -- so they get their own code space and
// are never confused with AGS3-RULE-* conformance.
function buildDataCode(format, checkNumber) {
  return `${format}-DATA-${String(checkNumber).toUpperCase()}`;
}

function createDataDiagnostic(format, checkNumber, checkId, severity, message, line, column, endColumn, extra = {}) {
  return {
    code: buildDataCode(format, checkNumber),
    ruleId: buildDataCode(format, checkNumber),
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
  buildDataCode,
  buildRuleCode,
  convertGenericCsvDiagnostic,
  createDataDiagnostic,
  createRuleDiagnostic
};
