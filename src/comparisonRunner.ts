import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { captureDirectory, captureScenario, captureStaticScenario } from './capture';
import { GitRepository } from './gitRepository';
import {
	expandPortTemplate,
	validateComparisonRequest,
	type CaptureResult,
	type ComparisonRequest,
	type ComparisonResult,
	type StaticCaptureResult,
} from './model';
import { findOpenPort, ManagedServer, runShellCommand, waitForUrl } from './processes';
import { renderComparisonGif, renderComparisonImages, resolveComparisonLayout } from './renderer';

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
			const candidateBranch = await repository.currentBranch();
			const candidateDirty = await repository.isDirty();

			if (request.installCommand) {
				onProgress('Installing baseline dependencies');
				await runShellCommand(request.installCommand, worktreePath, {}, token, text => this.output.append(text));
			}

			const viewport = request.viewport ?? { width: 1280, height: 720 };
			const beforeLabel = withShortSha(request.beforeLabel || request.baseRef, baseSha);
			const afterLabel = withShortSha(request.afterLabel || candidateBranch || 'After', candidateSha);
			const beforeColorScheme = request.beforeColorScheme ?? request.colorScheme ?? 'system';
			const afterColorScheme = request.afterColorScheme ?? request.colorScheme ?? 'system';
			if ((request.outputMode ?? 'animation') === 'image') {
				onProgress('Capturing Before image');
				const before = await this.captureStaticVersion(worktreePath, request, 'before', sessionDirectory, token);
				onProgress('Capturing After image');
				const after = await this.captureStaticVersion(repository.root, request, 'after', sessionDirectory, token);
				const layout = resolveComparisonLayout(viewport, before.region, after.region, request.layout ?? 'auto');
				onProgress('Rendering comparison images');
				const rendered = await renderComparisonImages(
					before.imagePath,
					after.imagePath,
					sessionDirectory,
					beforeLabel,
					afterLabel,
					viewport,
					before.region,
					after.region,
					before.recordingSize,
					after.recordingSize,
					before.resizeCues,
					after.resizeCues,
					before.zoomCues,
					after.zoomCues,
					request.borderColor ?? '#30363d',
					request.beforeLabelAlignment ?? 'top-left',
					request.afterLabelAlignment ?? 'top-right',
					layout,
					token,
					text => this.output.append(text),
				);
				const result: ComparisonResult = {
					outputMode: 'image',
					sessionId,
					sessionDirectory,
					comparisonPath: rendered.comparisonImagePath,
					beforePath: rendered.beforeImagePath,
					afterPath: rendered.afterImagePath,
					imagePath: rendered.comparisonImagePath,
					beforeImagePath: rendered.beforeImagePath,
					afterImagePath: rendered.afterImagePath,
					baseSha,
					candidateSha,
					candidateDirty,
					beforeLabel,
					afterLabel,
					beforeColorScheme,
					afterColorScheme,
					beforeObservedColorScheme: before.observedColorScheme,
					afterObservedColorScheme: after.observedColorScheme,
					layout,
				};
				await writeFile(path.join(sessionDirectory, 'session.json'), JSON.stringify({ request, result }, null, 2), 'utf8');
				return result;
			}

			onProgress('Recording Before');
			const before = await this.captureVersion(worktreePath, request, 'before', sessionDirectory, token);
			onProgress('Recording After');
			const after = await this.captureVersion(repository.root, request, 'after', sessionDirectory, token);
			const layout = resolveComparisonLayout(viewport, before.region, after.region, request.layout ?? 'auto');
			onProgress('Rendering comparison GIF');
			const rendered = await renderComparisonGif(
				before.videoPath,
				after.videoPath,
				sessionDirectory,
				beforeLabel,
				afterLabel,
				viewport,
				before.region,
				after.region,
				before.timings,
				after.timings,
				before.replayOffsetMs,
				after.replayOffsetMs,
				before.recordingSize,
				after.recordingSize,
				before.resizeCues,
				after.resizeCues,
				before.zoomCues,
				after.zoomCues,
				request.borderColor ?? '#30363d',
				request.beforeLabelAlignment ?? 'top-left',
				request.afterLabelAlignment ?? 'top-right',
				request.frameRate ?? 24,
				layout,
				token,
				text => this.output.append(text),
			);

			const result: ComparisonResult = {
				outputMode: 'animation',
				frameRate: request.frameRate ?? 24,
				sessionId,
				sessionDirectory,
				comparisonPath: rendered.comparisonGifPath,
				beforePath: rendered.beforeGifPath,
				afterPath: rendered.afterGifPath,
				gifPath: rendered.comparisonGifPath,
				beforeGifPath: rendered.beforeGifPath,
				afterGifPath: rendered.afterGifPath,
				beforeVideoPath: before.videoPath,
				afterVideoPath: after.videoPath,
				baseSha,
				candidateSha,
				candidateDirty,
				beforeLabel,
				afterLabel,
				beforeColorScheme,
				afterColorScheme,
				beforeObservedColorScheme: before.observedColorScheme,
				afterObservedColorScheme: after.observedColorScheme,
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

	private async captureStaticVersion(
		cwd: string,
		request: ComparisonRequest,
		side: 'before' | 'after',
		sessionDirectory: string,
		token: vscode.CancellationToken,
	): Promise<StaticCaptureResult> {
		const port = await findOpenPort();
		const command = expandPortTemplate(request.startCommand, port);
		const readyUrl = expandPortTemplate(request.readyUrl, port);
		const server = new ManagedServer(command, cwd, { PORT: String(port) }, text => this.output.append(text));
		server.start();
		try {
			await waitForUrl(readyUrl, token);
			return await captureStaticScenario(
				readyUrl,
				request.route,
				request.scenario,
				request.viewport ?? { width: 1280, height: 720 },
				side === 'before'
					? request.beforeColorScheme ?? request.colorScheme ?? 'system'
					: request.afterColorScheme ?? request.colorScheme ?? 'system',
				request.focusLocator,
				request.focusPadding ?? 16,
				captureDirectory(sessionDirectory, side),
				token,
			);
		} finally {
			await server.stop();
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
				side === 'before'
					? request.beforeColorScheme ?? request.colorScheme ?? 'system'
					: request.afterColorScheme ?? request.colorScheme ?? 'system',
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

function withShortSha(label: string, sha: string): string {
	return `${label} (${sha.slice(0, 8)})`;
}