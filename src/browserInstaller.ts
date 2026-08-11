import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';

export async function installManagedChromium(
	output: vscode.OutputChannel,
	token: vscode.CancellationToken,
): Promise<void> {
	const playwrightCli = path.join(path.dirname(require.resolve('playwright-core')), 'cli.js');
	await new Promise<void>((resolve, reject) => {
		const child = spawn(process.execPath, [playwrightCli, 'install', 'chromium'], {
			env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
			windowsHide: true,
		});
		child.stdout.on('data', data => output.append(String(data)));
		child.stderr.on('data', data => output.append(String(data)));
		const cancellation = token.onCancellationRequested(() => child.kill('SIGTERM'));
		child.once('error', error => {
			cancellation.dispose();
			reject(error);
		});
		child.once('exit', code => {
			cancellation.dispose();
			if (token.isCancellationRequested) {
				reject(new vscode.CancellationError());
			} else if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Chromium installation failed with exit code ${code}. See the PR UI Compare output.`));
			}
		});
	});
}