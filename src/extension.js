"use strict";

const vscode = require("vscode");
const { detectVersion } = require("./detector");
const { buildQuickFixes } = require("./codeActions/quickFixes");
const { lintText } = require("./linter/linter");

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("agslint");
  context.subscriptions.push(diagnostics);

  const lintDocument = async (document) => {
    if (!document || document.languageId !== "ags") {
      return;
    }

    const result = lintText(document.getText(), { baseDir: context.extensionPath });
    diagnostics.set(document.uri, result.diagnostics.map(toVsCodeDiagnostic));
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(lintDocument),
    vscode.workspace.onDidSaveTextDocument(lintDocument),
    vscode.workspace.onDidChangeTextDocument((event) => lintDocument(event.document)),
    vscode.window.onDidChangeActiveTextEditor((editor) => editor && lintDocument(editor.document)),
    vscode.languages.registerCodeActionsProvider(
      { language: "ags" },
      {
        provideCodeActions(document, _range, actionContext) {
          const text = document.getText();
          const lintResult = lintText(text, { baseDir: context.extensionPath });
          const actions = [];

          for (const diagnostic of actionContext.diagnostics) {
            if (diagnostic.source !== "agslint") {
              continue;
            }

            const lintDiagnostic = findLintDiagnostic(lintResult.diagnostics, diagnostic);
            if (!lintDiagnostic) {
              continue;
            }

            const fixes = buildQuickFixes(text, lintResult, lintDiagnostic, { baseDir: context.extensionPath });
            for (const fix of fixes) {
              const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
              const edit = new vscode.WorkspaceEdit();

              for (const change of fix.edits) {
                edit.replace(
                  document.uri,
                  new vscode.Range(document.positionAt(change.startOffset), document.positionAt(change.endOffset)),
                  change.newText
                );
              }

              action.diagnostics = [diagnostic];
              action.edit = edit;
              action.isPreferred = true;
              actions.push(action);
            }
          }

          return actions;
        }
      },
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("agslint.runLint", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      await lintDocument(editor.document);
      vscode.window.showInformationMessage("AGSLint diagnostics refreshed.");
    }),
    vscode.commands.registerCommand("agslint.showVersion", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const detected = detectVersion(editor.document.getText());
      const editionText = detected.edition ? ` (declared edition ${detected.edition})` : "";
      vscode.window.showInformationMessage(`Detected AGS ${detected.version}${editionText}: ${detected.reason}`);
    })
  );

  if (vscode.window.activeTextEditor) {
    lintDocument(vscode.window.activeTextEditor.document);
  }
}

function toVsCodeDiagnostic(diagnostic) {
  const range = new vscode.Range(
    new vscode.Position(Math.max(0, diagnostic.line - 1), Math.max(0, diagnostic.column - 1)),
    new vscode.Position(Math.max(0, diagnostic.line - 1), Math.max(0, diagnostic.endColumn - 1))
  );

  const severity = diagnostic.severity === "error"
    ? vscode.DiagnosticSeverity.Error
    : diagnostic.severity === "warning"
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Information;

  const output = new vscode.Diagnostic(range, diagnostic.message, severity);
  output.code = diagnostic.code;
  output.source = "agslint";
  return output;
}

function findLintDiagnostic(diagnostics, vscodeDiagnostic) {
  const code = String(vscodeDiagnostic.code || "");
  const line = vscodeDiagnostic.range.start.line + 1;
  const column = vscodeDiagnostic.range.start.character + 1;
  const endColumn = vscodeDiagnostic.range.end.character + 1;

  return diagnostics.find((diagnostic) =>
    diagnostic.code === code &&
    diagnostic.message === vscodeDiagnostic.message &&
    diagnostic.line === line &&
    diagnostic.column === column &&
    diagnostic.endColumn === endColumn
  ) || null;
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
