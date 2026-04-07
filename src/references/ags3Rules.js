"use strict";

const AGS3_RULES = {
  maxHeadingsPerGroup: 60,
  maxLineLength: 240,
  mandatoryGroups: ["PROJ", "UNIT"],
  recommendedGroups: ["ABBR"],
  unitExemptGroups: new Set(["ABBR", "CODE", "DICT", "UNIT"]),
  holeIdExemptGroups: new Set(["ABBR", "DICT", "UNIT", "FILE"]),
  codeRequiredWhenGroupsPresent: new Set(["CNMT", "?ICCT"])
};

module.exports = {
  AGS3_RULES
};
