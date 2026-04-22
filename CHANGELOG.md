# agslint

## 0.1.3

### Patch Changes

- Adjust AGS4 Rule 8 severity and quick fixes, and add AGS3 continuation and unit guidance to the diagnostics documentation.

## 0.1.2

### Patch Changes

- Added bundled AGS4 standard dictionaries for 4.0.3, 4.0.4, 4.1, 4.1.1, and 4.2, selected the matching AGS4 schema from `TRAN_AGS`, and reduced extension startup cost by switching runtime reference loading to generated JSON with cached, debounced linting.

## 0.1.1

### Patch Changes

- Ported editor-safe AGS4 checks from the AGS Python checker, introduced rule-number diagnostics, and aligned AGS3/AGS4 quick fixes and tests with the refactored lint pipeline.

## 0.1.0

### Patch Changes

- Initial private release of the AGSLint VS Code extension with AGS3 and AGS4 linting, diagnostics, quick fixes, and syntax support.
