import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { captureDirectory, captureScenario } from './capture';
import { GitRepository } from './gitRepository';
import {
	expandPortTemplate,
	validateComparisonRequest,
	type CaptureResult,
	type ComparisonRequest,
	type ComparisonResult,
} from './model';
import { findOpenPort, ManagedServer, runShellCommand, waitForUrl } from './processes';
import { renderComparisonGif, resolveComparisonLayout } from './renderer';

export class ComparisonRunner {
	constructor(
		private readonly storageRoot: string,
		private readonly output: vscode.OutputChannel,
	) {}

	async run(
		workspacePath: string,
		request: ComparisonRequest,
		token: vscode.CancellationToken,
		onProgress: (message: string) => void,
	): Promise<ComparisonResult> {
		validateComparisonRequest(request);
		const repository = await GitRepository.open(workspacePath);
		const sessionId = `${Date.now()}-${slug(request.scenario.name)}`;
		const sessionDirectory = path.join(this.storageRoot, 'sessions', sessionId);
		const worktreePath = path.join(sessionDirectory, 'before-worktree');
		await mkdir(captureDirectory(sessionDirectory, 'before'), { recursive: true });
		await mkdir(captureDirectory(sessionDirectory, 'after'), { recursive: true });

		let worktreeCreated = false;
		try {
			onProgress(`Preparing ${request.baseRef}`);
			const baseSha = await repository.addDetachedWorktree(request.baseRef, worktreePath);
			worktreeCreated = true;
			const candidateSha = await repository.headSha();
			const candidateDirty = await repository.isDirty();

			if (request.installCommand) {
				onProgress('Installing baseline dependencies');
				await runShellCommand(request.installCommand, worktreePath, {}, token, text => this.output.append(text));
			}

			onProgress('Recording Before');
			const before = await this.captureVersion(worktreePath, request, 'before', sessionDirectory, token);
			onProgress('Recording After');
			const after = await this.captureVersion(repository.root, request, 'after', sessionDirectory, token);

			onProgress('Rendering comparison GIF');
			const viewport = request.viewport ?? { width: 1280, height: 720 };
			const layout = resolveComparisonLayout(viewport, before.region, after.region, request.layout ?? 'auto');
			const gifPath = await renderComparisonGif(
				before.videoPath,
				after.videoPath,
				sessionDirectory,
				request.beforeLabel || `Before ${request.baseRef}`,
				request.afterLabel || 'After current workspace',
				viewport,
				before.region,
				after.region,
				layout,
				token,
				text => this.output.append(text),
			);

			const result: ComparisonResult = {
				sessionId,
				sessionDirectory,
				gifPath,
				beforeVideoPath: before.videoPath,
				afterVideoPath: after.videoPath,
				baseSha,
				candidateSha,
				candidateDirty,
				layout,
			};
			await writeFile(
				path.join(sessionDirectory, 'session.json'),
				JSON.stringify({ request, result, timings: { before: before.timings, after: after.timings } }, null, 2),
				'utf8',
			);
			return result;
		} finally {
			if (worktreeCreated) {
				onProgress('Cleaning up temporary worktree');
				await repository.removeWorktree(worktreePath);
			}
		}
	}

	private async captureVersion(
		cwd: string,
		request: ComparisonRequest,
		side: 'before' | 'after',
		sessionDirectory: string,
		token: vscode.CancellationToken,
	): Promise<CaptureResult> {
		const port = await findOpenPort();
		const command = expandPortTemplate(request.startCommand, port);
		const readyUrl = expandPortTemplate(request.readyUrl, port);
		const server = new ManagedServer(command, cwd, { PORT: String(port) }, text => this.output.append(text));
		server.start();
		try {
			await waitForUrl(readyUrl, token);
			return await captureScenario(
				readyUrl,
				request.route,
				request.scenario,
				request.viewport ?? { width: 1280, height: 720 },
				request.focusLocator,
				request.focusPadding ?? 16,
				captureDirectory(sessionDirectory, side),
				token,
			);
		} finally {
			await server.stop();
		}
	}
}

function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'comparison';
}