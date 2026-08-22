import { spawn } from 'node:child_process';
import type { OutputSink } from './host';

const EXTENSION_ID = 'bouzidanas.pr-ui-compare';

// Only a process started by a VS Code window inherits these, so a plain terminal session never
// launches an editor it was not already running inside.
function insideVsCodeWindow(): boolean {
	return Boolean(process.env.VSCODE_PID || process.env.VSCODE_IPC_HOOK || process.env.VSCODE_IPC_HOOK_CLI);
}

function opener(uri: string): { command: string; args: string[] } {
	switch (process.platform) {
		case 'darwin':
			return { command: 'open', args: [uri] };
		case 'win32':
			return { command: 'cmd', args: ['/c', 'start', '', uri] };
		default:
			return { command: 'xdg-open', args: [uri] };
	}
}

/**
 * Asks the installed extension to open its preview panel for a finished session, so a comparison
 * created from an MCP client inside VS Code lands in the same reviewer the VS Code tool opens.
 * Best effort: a missing extension, a different editor, or no editor at all is not an error.
 */
export function openIdePreview(sessionDirectory: string, log: OutputSink): void {
	const setting = process.env.PR_UI_COMPARE_IDE_PREVIEW;
	if (setting === '0') {
		return;
	}
	if (setting !== '1' && !insideVsCodeWindow()) {
		return;
	}
	const scheme = process.env.PR_UI_COMPARE_URI_SCHEME || 'vscode';
	const uri = `${scheme}://${EXTENSION_ID}/preview?session=${encodeURIComponent(sessionDirectory)}`;
	const { command, args } = opener(uri);
	try {
		const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
		child.once('error', error => log.appendLine(`Could not open the editor preview: ${error.message}`));
		child.unref();
	} catch (error) {
		log.appendLine(`Could not open the editor preview: ${error instanceof Error ? error.message : String(error)}`);
	}
}
