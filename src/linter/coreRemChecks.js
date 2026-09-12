"use strict";

// Data-consistency checks on CORE_REM, ported from AGS Extractor 4.2.4.
//
// These are not AGS format rules. The standard says nothing about what a remark
// may contain, so nothing here can be derived from the reference dictionaries --
// it comes from how site logs are actually written. They are reported under the
// AGS3-DATA-* code space to keep them distinct from AGS3-RULE-* conformance.
//
// Four rules:
//   AGS3-DATA-1  a depth range falls outside the core run it is recorded against
//   AGS3-DATA-2  the void the remark describes disagrees with CORE_PREC
//   AGS3-DATA-3  a depth pair is written high-low
//   AGS3-DATA-4  a marker is present but no depth range can be read from it

const { createDataDiagnostic } = require("./diagnostics");

// Depth ranges as remarks write them: whole numbers ("5-5.5"), three-digit
// depths, and unit suffixes ("5.00m bgl", "5.00m/bgl") that GEOL descriptions
// rarely carry.
const DEPTH = "\\d{1,3}(?:\\.\\d{1,2})?";
const UNIT = "(?:\\s*m(?:\\s*(?:/\\s*|\\s+)bgl)?|\\s*bgl)?";
const RANGE_PATTERN = `(${DEPTH})${UNIT}\\s*(?:-|to)\\s*(${DEPTH})${UNIT}`;

// A match with no decimal place and no unit is not a depth range. Descriptions
// list joint dip angles as "J1 0-30 J2 30-60 J3 60-90", and reading those as
// depths tags every layer from 0 to 90m.
const UNIT_EVIDENCE_RE = /m|bgl/i;

const MARKERS = [
  { key: "coreloss", label: "core loss", pattern: "core\\s*-?\\s*loss", consumesCore: true },
  { key: "cavity", label: "cavity", pattern: "cavit(?:y|ies)", consumesCore: true },
  // A washbored interval is not cored, so CORE_PREC says nothing about it.
  { key: "washboring", label: "wash boring", pattern: "wash\\s*-?\\s*bor(?:ing|ed|e)", consumesCore: false }
];

// Scanning forward from one marker stops at the next marker, a sentence end, or
// a closing parenthesis, so a range written after "cavity" is never attributed
// to a preceding "core loss", and "(Coreloss at 42.93-43.55m), Highly fractured
// ... J1 0-30" does not spill past the parenthetical.
const BOUNDARY_RE = new RegExp(`\\.\\s|[;\\n)]|${MARKERS.map((marker) => marker.pattern).join("|")}`, "i");

// AGS depths are 2DP; anything under half a centimetre is rounding.
const TOLERANCE = 0.02;

function parseNumber(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!text) {
    return null;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Depth pairs per anomaly, exactly as written -- before ordering.
 * An entry is present for every marker found, even when it carried no range.
 */
function scanCoreRem(text) {
  const value = String(text === undefined || text === null ? "" : text).replace(/\s+/g, " ").trim();
  if (!value) {
    return [];
  }

  const found = [];
  for (const marker of MARKERS) {
    const hit = new RegExp(marker.pattern, "i").exec(value);
    if (!hit) {
      continue;
    }

    let tail = value.slice(hit.index + hit[0].length);
    const boundary = BOUNDARY_RE.exec(tail);
    if (boundary) {
      tail = tail.slice(0, boundary.index);
    }

    const pairs = [];
    const rangeRe = new RegExp(RANGE_PATTERN, "gi");
    let match = rangeRe.exec(tail);
    while (match !== null) {
      if (match[0].includes(".") || UNIT_EVIDENCE_RE.test(match[0])) {
        const first = parseNumber(match[1]);
        const second = parseNumber(match[2]);
        if (first !== null && second !== null) {
          pairs.push([first, second]);
        }
      }
      match = rangeRe.exec(tail);
    }

    found.push({ key: marker.key, label: marker.label, consumesCore: marker.consumesCore, pairs });
  }

  return found;
}

/**
 * Issues for one CORE row. Returns { checkNumber, checkId, severity, message }.
 *
 * Depths are read as written, only put the right way round: a range that merely
 * looks wrong cannot be told apart from a correct one attached to the
 * neighbouring row, so narrowing it would discard real records. That is exactly
 * why these are reported rather than silently corrected.
 */
function checkCoreRemRow({ remark, runTop, runBase, recovery, solidRecovery }) {
  const scanned = scanCoreRem(remark);
  if (!scanned.length) {
    return [];
  }

  const issues = [];
  const runLength = runTop !== null && runBase !== null && runBase > runTop ? runBase - runTop : null;
  let voidWritten = 0;
  let sawVoidRange = false;

  for (const anomaly of scanned) {
    if (!anomaly.pairs.length) {
      issues.push({
        checkNumber: 4,
        checkId: "ags3.core.rem.range-unreadable",
        severity: "information",
        message: `CORE_REM mentions ${anomaly.label} but no depth range could be read from it.`
      });
      continue;
    }

    for (const [first, second] of anomaly.pairs) {
      const top = Math.min(first, second);
      const base = Math.max(first, second);

      if (first > second) {
        issues.push({
          checkNumber: 3,
          checkId: "ags3.core.rem.depths-transposed",
          severity: "warning",
          message: `CORE_REM ${anomaly.label} depths are written high-low (${first.toFixed(2)}-${second.toFixed(2)}); read as ${top.toFixed(2)}-${base.toFixed(2)}.`
        });
      }

      if (top === base) {
        issues.push({
          checkNumber: 4,
          checkId: "ags3.core.rem.range-zero-length",
          severity: "information",
          message: `CORE_REM ${anomaly.label} range ${top.toFixed(2)}-${base.toFixed(2)} has zero length.`
        });
        continue;
      }

      if (runLength !== null && (top < runTop - TOLERANCE || base > runBase + TOLERANCE)) {
        issues.push({
          checkNumber: 1,
          checkId: "ags3.core.rem.outside-run",
          severity: "warning",
          message: `CORE_REM ${anomaly.label} range ${top.toFixed(2)}-${base.toFixed(2)} lies outside its core run ${runTop.toFixed(2)}-${runBase.toFixed(2)}.`
        });
      }

      if (anomaly.consumesCore) {
        voidWritten += base - top;
        sawVoidRange = true;
      }
    }
  }

  if (!sawVoidRange || runLength === null || recovery === null) {
    return issues;
  }

  if (recovery < 0 || recovery > 100) {
    issues.push({
      checkNumber: 2,
      checkId: "ags3.core.rem.recovery-not-percentage",
      severity: "warning",
      message: `CORE_PREC=${recovery} is not a percentage; the CORE_REM recovery cross-check was skipped.`
    });
    return issues;
  }

  // CORE_SREC (solid) can never exceed CORE_PREC (total); when it does the two
  // columns are transposed and the arithmetic below would be nonsense.
  if (solidRecovery !== null && solidRecovery > recovery + TOLERANCE) {
    issues.push({
      checkNumber: 2,
      checkId: "ags3.core.rem.recovery-columns-transposed",
      severity: "warning",
      message: `CORE_SREC=${solidRecovery} exceeds CORE_PREC=${recovery}; the CORE_REM recovery cross-check was skipped.`
    });
    return issues;
  }

  const expected = (1 - recovery / 100) * runLength;
  if (voidWritten > expected + TOLERANCE) {
    issues.push({
      checkNumber: 2,
      checkId: "ags3.core.rem.void-exceeds-recovery",
      severity: "warning",
      message: `CORE_REM records ${round2(voidWritten).toFixed(2)}m of void, more than the ${round2(expected).toFixed(2)}m implied by CORE_PREC=${recovery}% over a ${round2(runLength).toFixed(2)}m run.`
    });
  } else if (voidWritten < expected - TOLERANCE) {
    // Reported separately from the "exceeds" case: CORE_REM need not enumerate
    // every loss in a run, so a short remark is suspicious but legitimate.
    issues.push({
      checkNumber: 2,
      checkId: "ags3.core.rem.void-below-recovery",
      severity: "information",
      message: `CORE_REM records ${round2(voidWritten).toFixed(2)}m of void, less than the ${round2(expected).toFixed(2)}m implied by CORE_PREC=${recovery}%; the remark may cover only part of the loss.`
    });
  }

  return issues;
}

/**
 * Run the CORE_REM checks over the parsed CORE rows and append diagnostics.
 *
 * `getRowFieldValue` is injected so this module does not need to know how the
 * linter resolves optional "?" heading prefixes.
 */
function lintAgs3CoreRem(diagnostics, rowsByGroup, getRowFieldValue) {
  const rows = rowsByGroup.get("CORE");
  if (!rows || !rows.length) {
    return;
  }

  for (const row of rows) {
    const remark = getRowFieldValue(row, "CORE_REM");
    if (!remark) {
      continue;
    }

    const issues = checkCoreRemRow({
      remark,
      runTop: parseNumber(getRowFieldValue(row, "CORE_TOP")),
      runBase: parseNumber(getRowFieldValue(row, "CORE_BOT")),
      recovery: parseNumber(getRowFieldValue(row, "CORE_PREC")),
      solidRecovery: parseNumber(getRowFieldValue(row, "CORE_SREC"))
    });
    if (!issues.length) {
      continue;
    }

    // Point the squiggle at the CORE_REM cell when its position is known.
    // Tokens carry 1-based `start`/`end` spanning the quoted text.
    let column = 1;
    let endColumn = Math.max(2, (row.raw ? row.raw.length : 0) + 1);
    const remarkIndex = row.headingIndex ? row.headingIndex.get("CORE_REM") : undefined;
    const cell = row.cells && remarkIndex !== undefined ? row.cells[remarkIndex] : undefined;
    if (cell && cell.start) {
      column = cell.start;
      endColumn = Math.max(column + 1, (cell.end || cell.start) + 1);
    }

    for (const issue of issues) {
      diagnostics.push(
        createDataDiagnostic(
          "AGS3",
          issue.checkNumber,
          issue.checkId,
          issue.severity,
          issue.message,
          row.lineNumber,
          column,
          endColumn
        )
      );
    }
  }
}

module.exports = {
  checkCoreRemRow,
  lintAgs3CoreRem,
  scanCoreRem
};
