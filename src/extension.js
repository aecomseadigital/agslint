"use strict";

const vscode = require("vscode");
const { detectVersion } = require("./detector");
const { buildQuickFixes } = require("./codeActions/quickFixes");
const { lintText } = require("./linter/linter");

const CHANGE_LINT_DELAY_MS = 200;
const INITIAL_LINT_DELAY_MS = 150;

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection("agslint");
  context.subscriptions.push(diagnostics);
  const lintCache = new Map();
  const pendingLintTimers = new Map();

  function getDocumentKey(document) {
    return document.uri.toString();
  }

  function clearPendingLint(document) {
    const key = getDocumentKey(document);
    const timer = pendingLintTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      pendingLintTimers.delete(key);
    }
  }

  function clearDocumentState(document) {
    clearPendingLint(document);
    lintCache.delete(getDocumentKey(document));
    diagnostics.delete(document.uri);
  }

  function getCachedLintResult(document) {
    const cached = lintCache.get(getDocumentKey(document));
    if (!cached || cached.version !== document.version) {
      return null;
    }

    return cached.result;
  }

  function computeLintResult(document) {
    if (!document || document.languageId !== "ags") {
      return null;
    }

    const cached = getCachedLintResult(document);
    if (cached) {
      return cached;
    }

    const result = lintText(document.getText(), { baseDir: context.extensionPath });
    lintCache.set(getDocumentKey(document), {
      version: document.version,
      result
    });
    return result;
  }

  const lintDocument = (document) => {
    const result = computeLintResult(document);
    if (!result) {
      return;
    }

    diagnostics.set(document.uri, result.diagnostics.map(toVsCodeDiagnostic));
  };

  const scheduleLint = (document, delayMs = 0) => {
    if (!document || document.languageId !== "ags") {
      return;
    }

    clearPendingLint(document);
    const key = getDocumentKey(document);
    const timer = setTimeout(() => {
      pendingLintTimers.delete(key);
      lintDocument(document);
    }, delayMs);
    pendingLintTimers.set(key, timer);
  };

  const lintVisibleOpenDocument = (document) => {
    if (!document || document.languageId !== "ags") {
      return;
    }

    const isVisible = vscode.window.visibleTextEditors
      .some((editor) => editor.document.uri.toString() === document.uri.toString());

    if (isVisible) {
      scheduleLint(document);
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(lintVisibleOpenDocument),
    vscode.workspace.onDidSaveTextDocument((document) => scheduleLint(document)),
    vscode.workspace.onDidCloseTextDocument(clearDocumentState),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleLint(event.document, CHANGE_LINT_DELAY_MS)),
    vscode.window.onDidChangeActiveTextEditor((editor) => editor && scheduleLint(editor.document)),
    vscode.languages.registerCodeActionsProvider(
      { language: "ags" },
      {
        provideCodeActions(document, _range, actionContext) {
          const text = document.getText();
          const lintResult = computeLintResult(document);
          if (!lintResult) {
            return [];
          }
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

      lintDocument(editor.document);
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

  context.subscriptions.push({
    dispose() {
      for (const timer of pendingLintTimers.values()) {
        clearTimeout(timer);
      }
      pendingLintTimers.clear();
      lintCache.clear();
    }
  });

  if (vscode.window.activeTextEditor) {
    scheduleLint(vscode.window.activeTextEditor.document, INITIAL_LINT_DELAY_MS);
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
