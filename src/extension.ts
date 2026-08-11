import { access, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { installManagedChromium } from './browserInstaller';
import { CreateComparisonTool } from './compareTool';
import { ComparisonRunner } from './comparisonRunner';
import { GitRepository } from './gitRepository';
import type { ComparisonRequest, ComparisonResult, ScenarioAction } from './model';
import { showComparisonResult } from './previewPanel';
import { cleanupExpiredSessions } from './sessionStorage';

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('PR UI Compare', { log: true });
	context.subscriptions.push(output);
	const storageRoot = (context.storageUri ?? context.globalStorageUri).fsPath;
	const runner = new ComparisonRunner(storageRoot, output);
	const retentionDays = vscode.workspace.getConfiguration('prUiCompare').get<number>('retentionDays', 7);
	void cleanupExpiredSessions(storageRoot, retentionDays).then(removed => {
		if (removed > 0) {
			output.info(`Removed ${removed} expired comparison session(s).`);
		}
	}, error => output.error(`Could not clean expired sessions: ${String(error)}`));
	const execute = async (request: ComparisonRequest, token: vscode.CancellationToken): Promise<ComparisonResult> => {
		const workspacePath = requireWorkspace();
		const result = await runWithProgress(runner, workspacePath, request, token);
		await showComparisonResult(result, request);
		return result;
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('pr-ui-compare.installBrowser', async () => {
			output.show(true);
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Installing Chromium for PR UI Compare',
				cancellable: true,
			}, async (_progress, token) => installManagedChromium(output, token));
			await vscode.window.showInformationMessage('Managed Chromium is ready for PR UI Compare.');
		}),
		vscode.commands.registerCommand('pr-ui-compare.createComparison', async () => {
			try {
				const workspacePath = requireWorkspace();
				const request = await collectRequest(workspacePath);
				if (request) {
					await execute(request, new vscode.CancellationTokenSource().token);
				}
			} catch (error) {
				output.show(true);
				await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
			}
		}),
		vscode.lm.registerTool('pr-ui-compare_createComparison', new CreateComparisonTool(execute)),
	);
}

function requireWorkspace(): string {
	if (!vscode.workspace.isTrusted) {
		throw new Error('Trust this workspace before running project commands for a UI comparison.');
	}
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder || folder.uri.scheme !== 'file') {
		throw new Error('Open a local Git repository to create a PR UI comparison.');
	}
	return folder.uri.fsPath;
}

async function runWithProgress(
	runner: ComparisonRunner,
	workspacePath: string,
	request: ComparisonRequest,
	externalToken: vscode.CancellationToken,
): Promise<ComparisonResult> {
	return vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: 'PR UI Compare',
		cancellable: true,
	}, async (progress, progressToken) => {
		const cancellation = new vscode.CancellationTokenSource();
		const subscriptions = [
			externalToken.onCancellationRequested(() => cancellation.cancel()),
			progressToken.onCancellationRequested(() => cancellation.cancel()),
		];
		try {
			return await runner.run(workspacePath, request, cancellation.token, message => progress.report({ message }));
		} finally {
			subscriptions.forEach(subscription => subscription.dispose());
			cancellation.dispose();
		}
	});
}

async function collectRequest(workspacePath: string): Promise<ComparisonRequest | undefined> {
	const repository = await GitRepository.open(workspacePath);
	const baseRef = await vscode.window.showInputBox({
		title: 'PR UI Compare (1/7)',
		prompt: 'Git ref for the original repository behavior',
		value: await repository.suggestBaseRef(),
		ignoreFocusOut: true,
	});
	if (!baseRef) {
		return undefined;
	}
	const defaults = await detectProjectDefaults(workspacePath);
	const startCommand = await vscode.window.showInputBox({
		title: 'PR UI Compare (2/7)',
		prompt: 'Command that starts the application. Use {port} where the port belongs.',
		value: defaults.startCommand,
		ignoreFocusOut: true,
	});
	if (!startCommand) {
		return undefined;
	}
	const readyUrl = await vscode.window.showInputBox({
		title: 'PR UI Compare (3/7)',
		prompt: 'URL that indicates the application is ready',
		value: 'http://127.0.0.1:{port}',
		ignoreFocusOut: true,
	});
	if (!readyUrl) {
		return undefined;
	}
	const installCommand = await vscode.window.showInputBox({
		title: 'PR UI Compare (4/7)',
		prompt: 'Command to install dependencies in the temporary Before worktree. Leave blank to skip.',
		value: defaults.installCommand,
		ignoreFocusOut: true,
	});
	if (installCommand === undefined) {
		return undefined;
	}
	const route = await vscode.window.showInputBox({
		title: 'PR UI Compare (5/7)',
		prompt: 'Application route to record',
		value: '/',
		ignoreFocusOut: true,
	});
	if (route === undefined) {
		return undefined;
	}
	const focusLocator = await vscode.window.showInputBox({
		title: 'PR UI Compare (6/7)',
		prompt: 'Optional Playwright locator for the UI region to crop around. Leave blank for the full viewport.',
		value: '',
		ignoreFocusOut: true,
	});
	if (focusLocator === undefined) {
		return undefined;
	}
	const actionsJson = await vscode.window.showInputBox({
		title: 'PR UI Compare (7/7)',
		prompt: 'Scenario actions as a JSON array. Agents can create richer scenarios through the PR UI Compare tool.',
		value: '[{"type":"hold","durationMs":2000}]',
		ignoreFocusOut: true,
	});
	if (!actionsJson) {
		return undefined;
	}
	let actions: ScenarioAction[];
	try {
		actions = JSON.parse(actionsJson) as ScenarioAction[];
		if (!Array.isArray(actions)) {
			throw new Error('not an array');
		}
	} catch {
		throw new Error('Scenario actions must be a valid JSON array.');
	}
	return {
		baseRef,
		startCommand,
		readyUrl,
		installCommand: installCommand || undefined,
		route,
		focusLocator: focusLocator || undefined,
		scenario: { name: `UI comparison against ${baseRef}`, actions },
	};
}

async function detectProjectDefaults(workspacePath: string): Promise<{ startCommand: string; installCommand: string }> {
	const packageManager = await detectPackageManager(workspacePath);
	let hasDevScript = true;
	try {
		const packageJson = JSON.parse(await readFile(path.join(workspacePath, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		hasDevScript = Boolean(packageJson.scripts?.dev);
	} catch {
		hasDevScript = false;
	}
	const script = hasDevScript ? 'dev' : 'start';
	if (packageManager === 'yarn') {
		return { startCommand: `yarn ${script} --port {port}`, installCommand: 'yarn install --frozen-lockfile' };
	}
	return {
		startCommand: `${packageManager} run ${script} -- --port {port}`,
		installCommand: packageManager === 'pnpm' ? 'pnpm install --frozen-lockfile' : 'npm ci',
	};
}

async function detectPackageManager(workspacePath: string): Promise<'npm' | 'pnpm' | 'yarn'> {
	for (const [lockfile, packageManager] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn']] as const) {
		try {
			await access(path.join(workspacePath, lockfile));
			return packageManager;
		} catch {
			// Try the next supported lockfile.
		}
	}
	return 'npm';
}
