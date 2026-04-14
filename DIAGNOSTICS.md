# AGSLint Diagnostic Reference

Public diagnostics now use rule-number codes:

- `AGS3-RULE-<rule>`
- `AGS4-RULE-<rule>`

The linter also attaches an internal `checkId` used by quick fixes and tests.

## AGS3

Implemented AGS3 rule coverage currently includes:

- `AGS3-RULE-1`: non-ASCII characters
- `AGS3-RULE-4`: missing heading rows and column-count mismatches
- `AGS3-RULE-5`: unknown standard groups/headings and canonical-heading suggestions
- `AGS3-RULE-6`, `6A`, `6B`, `6C`: key presence, key ordering, duplicate key combinations, and parent references
- `AGS3-RULE-8`: unquoted values
- `AGS3-RULE-9`: invalid tab delimiters and suppressed low-level CSV delimiter issues
- `AGS3-RULE-12`: line length
- `AGS3-RULE-13`: malformed heading continuations
- `AGS3-RULE-14`: malformed `<CONT>` continuation rows
- `AGS3-RULE-15`: whitespace-only quoted nulls
- `AGS3-RULE-17`: more than 60 headings
- `AGS3-RULE-18`, `18A`, `18B`: missing/malformed `<UNITS>`, malformed units continuations, and missing `UNIT`
- `AGS3-RULE-19`: missing `PROJ`
- `AGS3-RULE-20`: missing `ABBR`
- `AGS3-RULE-21`: missing `DICT` when custom names are used
- `AGS3-RULE-22`: invalid custom group names
- `AGS3-RULE-23`: invalid custom heading names
- `AGS3-RULE-25`: missing `CODE` when `CNMT` or `?ICCT` is present

## AGS4

Implemented AGS4 rule coverage currently includes:

- `AGS4-RULE-1`: BOM and non-ASCII characters
- `AGS4-RULE-2`, `2A`, `2B`: missing `DATA`, LF-vs-CRLF line endings, and misplaced/missing/duplicate structural rows
- `AGS4-RULE-4`: malformed `GROUP` rows and row-width mismatches
- `AGS4-RULE-5`: unquoted values and whitespace-only quoted values
- `AGS4-RULE-6`: invalid tab delimiters and low-level CSV delimiter issues
- `AGS4-RULE-7`: duplicate headings and heading-order mismatches
- `AGS4-RULE-8`: reference `TYPE`/`UNIT` mismatches plus supported data-type validation (`DP`, `SCI`, `SF`, `DT`, `T`, `U`, `YN`, `DMS`, `ID`)
- `AGS4-RULE-9`: unknown groups and headings
- `AGS4-RULE-10A`, `10B`, `10C`: key presence, duplicate key combinations, empty required values, and parent-group checks
- `AGS4-RULE-11A`, `11B`, `11C`: missing `TRAN_DLIM` / `TRAN_RCON` and invalid `RL` record links
- `AGS4-RULE-13`, `14`: `PROJ` / `TRAN` existence and single-`DATA`-row cardinality
- `AGS4-RULE-15`: missing `UNIT` group and undefined units
- `AGS4-RULE-16`: missing `ABBR` group and undefined abbreviation values for `PA` fields
- `AGS4-RULE-17`: missing `TYPE` group and undefined data types
- `AGS4-RULE-18`: missing `DICT` when unknown groups/headings are present
- `AGS4-RULE-19`, `19A`, `19B`: invalid group names and heading naming/prefix rules
- `AGS4-RULE-20`: in-document `FILE_FSET` / `FILE` consistency checks

## Notes

- AGS4 validation uses the bundled dictionary that matches `TRAN_AGS`, with fallback to bundled AGS4.2 when the edition is missing or unsupported.
- In-file AGS4 `DICT` definitions are merged into the bundled dictionary at lint time.
- AGS4 Rule 20 is editor-only here: the linter does not inspect sibling folders or physical files on disk.

## Source Files

- [src/linter/linter.js](/c:/Users/ZhongY2/source/repos/agslint/src/linter/linter.js)
- [src/linter/diagnostics.js](/c:/Users/ZhongY2/source/repos/agslint/src/linter/diagnostics.js)
- [src/parser/ags3Parser.js](/c:/Users/ZhongY2/source/repos/agslint/src/parser/ags3Parser.js)
- [src/parser/ags4Parser.js](/c:/Users/ZhongY2/source/repos/agslint/src/parser/ags4Parser.js)
- [src/utils/lineParser.js](/c:/Users/ZhongY2/source/repos/agslint/src/utils/lineParser.js)
