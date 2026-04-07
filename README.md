# AGSLint

AGSLint is the world's first open-sourced VS Code extension for linting and validating AGS3 and AGS4 `.ags` files for geotechnical engineers. This repo currently targets local and private extension use, with AGS reference data stored in the repo and editor diagnostics provided directly by the extension.

## Tribute

This project is built with clear respect for the AGS Python Library maintained by the AGS Data Format Working Group. Their work on reading, writing, and checking AGS files, together with the surrounding documentation and standards guidance, has materially improved the AGS tooling ecosystem and helped establish a stronger foundation for projects like this one.

References:

- AGS Python Library README: https://gitlab.com/ags-data-format-wg/ags-python-library/-/blob/main/README.md
- AGS Python Library documentation: https://ags-data-format-wg.gitlab.io/ags-python-library/

## Current Capabilities

- Registers the `ags` language and `.ags` file extension in VS Code
- Provides AGS syntax highlighting through the bundled TextMate grammar
- Detects AGS3 versus AGS4 content
- Reports diagnostics for structural, schema, and formatting issues
- Provides quick fixes for selected lint findings
- Adds these command palette commands:
  - `AGSLint: Run Lint on File`
  - `AGSLint: Show AGS Version`

## Repo Layout

- `src/` contains the extension entrypoint, linter, parsers, references, and tests
- `ref/` contains raw AGS reference files used as source data
- `generated/` contains optional derived JSON outputs produced from the reference data
- `syntaxes/` contains the TextMate grammar for AGS syntax highlighting
- `scripts/` contains helper scripts for reference generation and file linting

## Local Development

Install dependencies:

```bash
npm install
```

Run the test suite:

```bash
npm test
```

Rebuild the generated reference JSON:

```bash
npm run build-references
```

To run the extension in VS Code, open this repo in VS Code and start the existing `Run AGSLint Extension` launch configuration from `.vscode/launch.json`.

## Packaging Status

VSIX packaging and release automation are planned, but the repo does not yet contain a finalized packaging or publishing workflow. The extension manifest still uses a placeholder local publisher and should currently be treated as a local or private extension project.


## Status And Limitations

- `package.json` still uses `publisher: "local"`
- The extension is currently intended for local or private use rather than Marketplace distribution
- Reference data is sourced from files committed under `ref/`
- `generated/` is rebuildable helper output, not the primary runtime source of truth
