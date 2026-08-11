import { copyFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ComparisonRequest, ComparisonResult } from './model';

export async function showComparisonResult(
	result: ComparisonResult,
	request: ComparisonRequest,
): Promise<void> {
	const panel = vscode.window.createWebviewPanel(
		'prUiCompare.preview',
		`PR UI Compare: ${request.scenario.name}`,
		vscode.ViewColumn.Active,
		{ enableScripts: true, localResourceRoots: [vscode.Uri.file(result.sessionDirectory)] },
	);
	const gifUri = panel.webview.asWebviewUri(vscode.Uri.file(result.gifPath));
	panel.webview.html = previewHtml(panel.webview, gifUri, result, request);
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save') {
			await saveGif(result.gifPath, request.scenario.name);
		} else if (message?.type === 'reveal') {
			await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.sessionDirectory));
		}
	});
}

async function saveGif(sourcePath: string, scenarioName: string): Promise<void> {
	const destination = await vscode.window.showSaveDialog({
		filters: { GIF: ['gif'] },
		saveLabel: 'Export comparison GIF',
		defaultUri: vscode.Uri.file(path.join(os.homedir(), `${fileName(scenarioName)}.gif`)),
	});
	if (!destination) {
		return;
	}
	await copyFile(sourcePath, destination.fsPath);
	await vscode.window.showInformationMessage(`Saved ${path.basename(destination.fsPath)}.`, 'Reveal')
		.then(action => action === 'Reveal' && vscode.commands.executeCommand('revealFileInOS', destination));
}

function previewHtml(
	webview: vscode.Webview,
	gifUri: vscode.Uri,
	result: ComparisonResult,
	request: ComparisonRequest,
): string {
	const contentSecurityPolicy = `default-src 'none'; img-src ${webview.cspSource}; style-src 'nonce-preview'; script-src 'nonce-preview';`;
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>PR UI Compare</title>
	<style nonce="preview">
		body { color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); margin: 0; padding: 24px; }
		main { margin: 0 auto; max-width: 1440px; }
		h1 { font-size: 20px; font-weight: 600; margin: 0 0 6px; }
		.meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 18px; }
		.preview { background: #181818; border: 1px solid var(--vscode-panel-border); display: block; max-height: calc(100vh - 140px); max-width: 100%; }
		.warning { color: var(--vscode-editorWarning-foreground); font-size: 12px; margin-top: 12px; }
		.actions { display: flex; gap: 8px; margin-top: 16px; }
		button { background: var(--vscode-button-background); border: 0; color: var(--vscode-button-foreground); cursor: pointer; font: inherit; padding: 7px 12px; }
		button:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
		button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
		code { font-family: var(--vscode-editor-font-family); }
	</style>
</head>
<body>
	<main>
		<h1>${escapeHtml(request.scenario.name)}</h1>
		<p class="meta"><code>${escapeHtml(shortSha(result.baseSha))}</code> compared with <code>${escapeHtml(shortSha(result.candidateSha || 'working-tree'))}</code></p>
		<img class="preview" src="${gifUri}" alt="Before and After UI comparison">
		${result.candidateDirty ? '<p class="warning">The After capture includes uncommitted changes. Regenerate after committing and pushing before publishing the PR.</p>' : ''}
		<div class="actions">
			<button id="save" type="button">Save GIF As...</button>
			<button id="reveal" class="secondary" type="button">Reveal Session</button>
		</div>
	</main>
	<script nonce="preview">
		const vscode = acquireVsCodeApi();
		document.getElementById('save').addEventListener('click', () => vscode.postMessage({ type: 'save' }));
		document.getElementById('reveal').addEventListener('click', () => vscode.postMessage({ type: 'reveal' }));
	</script>
</body>
</html>`;
}

function shortSha(value: string): string {
	return value.slice(0, 8);
}

function fileName(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ui-comparison';
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"]/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
	}[character] || character));
}