import { spawn } from 'node:child_process';
import * as path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import * as vscode from 'vscode';
import type {
	ActionTiming,
	CaptureRegion,
	ComparisonLayout,
	ResolvedComparisonLayout,
	Viewport,
} from './model';

const EXTREME_WIDE_ASPECT_RATIO = 3;

export async function renderComparisonGif(
	beforeVideoPath: string,
	afterVideoPath: string,
	outputDirectory: string,
	beforeLabel: string,
	afterLabel: string,
	viewport: Viewport,
	beforeRegion: CaptureRegion | undefined,
	afterRegion: CaptureRegion | undefined,
	beforeTimings: ActionTiming[],
	afterTimings: ActionTiming[],
	beforeReplayOffsetMs: number,
	afterReplayOffsetMs: number,
	layoutPreference: ComparisonLayout,
	token: vscode.CancellationToken,
	onOutput: (text: string) => void,
): Promise<string> {
	if (!ffmpegPath) {
		throw new Error('No FFmpeg binary is available for this operating system and architecture.');
	}
	const executablePath = ffmpegPath;
	const outputPath = path.join(outputDirectory, 'comparison.gif');
	const layout = resolveComparisonLayout(viewport, beforeRegion, afterRegion, layoutPreference);
	const filter = createFilter(
		beforeLabel,
		afterLabel,
		beforeRegion,
		afterRegion,
		beforeTimings,
		afterTimings,
		beforeReplayOffsetMs,
		afterReplayOffsetMs,
		layout,
	);
	const args = [
		'-y',
		'-i', beforeVideoPath,
		'-i', afterVideoPath,
		'-filter_complex', filter,
		'-map', '[out]',
		'-loop', '0',
		outputPath,
	];

	await new Promise<void>((resolve, reject) => {
		const child = spawn(executablePath, args, { windowsHide: true });
		child.stdout.on('data', data => onOutput(String(data)));
		child.stderr.on('data', data => onOutput(String(data)));
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
				reject(new Error(`FFmpeg failed with exit code ${code}. See the PR UI Compare output for details.`));
			}
		});
	});
	return outputPath;
}

export function resolveComparisonLayout(
	viewport: Viewport,
	beforeRegion: CaptureRegion | undefined,
	afterRegion: CaptureRegion | undefined,
	preference: ComparisonLayout = 'auto',
): ResolvedComparisonLayout {
	if (preference !== 'auto') {
		return preference;
	}
	const regions = [beforeRegion, afterRegion].filter((region): region is CaptureRegion => Boolean(region));
	const widestAspectRatio = regions.length > 0
		? Math.max(...regions.map(region => region.width / region.height))
		: viewport.width / viewport.height;
	return widestAspectRatio >= EXTREME_WIDE_ASPECT_RATIO ? 'vertical' : 'horizontal';
}

function createFilter(
	beforeLabel: string,
	afterLabel: string,
	beforeRegion: CaptureRegion | undefined,
	afterRegion: CaptureRegion | undefined,
	beforeTimings: ActionTiming[],
	afterTimings: ActionTiming[],
	beforeReplayOffsetMs: number,
	afterReplayOffsetMs: number,
	layout: ResolvedComparisonLayout,
): string {
	const targetDurations = resolveSynchronizedDurations(beforeTimings, afterTimings);
	const beforeTimeline = synchronizeTimeline(0, 'before', beforeTimings, beforeReplayOffsetMs, targetDurations);
	const afterTimeline = synchronizeTimeline(1, 'after', afterTimings, afterReplayOffsetMs, targetDurations);
	const leftLabel = escapeDrawText(beforeLabel);
	const rightLabel = escapeDrawText(afterLabel);
	const scale = layout === 'vertical' ? 'scale=960:-2' : 'scale=-2:360';
	const prepare = (region: CaptureRegion | undefined) => `${crop(region)}fps=12,${scale}:flags=lanczos,setsar=1`;
	const text = (label: string, corner: 'left' | 'right') => [
		`drawtext=text='${label}'`,
		'fontcolor=white',
		'fontsize=18',
		`x=${corner === 'left' ? '14' : 'w-text_w-14'}`,
		'y=14',
		'box=1',
		'boxcolor=black@0.72',
		'boxborderw=7',
	].join(':');
	const border = 'pad=iw+6:ih+6:3:3:color=white';
	const stack = layout === 'vertical'
		? '[before][after]vstack=inputs=2:shortest=1[stack]'
		: '[before][after]hstack=inputs=2:shortest=1[stack]';
	return [
		...beforeTimeline.filters,
		...afterTimeline.filters,
		`${beforeTimeline.output}${prepare(beforeRegion)},${text(leftLabel, 'left')},${border}[before]`,
		`${afterTimeline.output}${prepare(afterRegion)},${text(rightLabel, 'right')},${border}[after]`,
		stack,
		'[stack]split[paletteSource][gifSource]',
		'[paletteSource]palettegen=max_colors=128[palette]',
		'[gifSource][palette]paletteuse=dither=bayer[out]',
	].join(';');
}

export function resolveSynchronizedDurations(before: ActionTiming[], after: ActionTiming[]): number[] {
	if (before.length === 0 || before.length !== after.length) {
		throw new Error('Before and After captures must contain the same nonempty action timeline.');
	}
	return before.map((beforeTiming, index) => {
		const afterTiming = after[index];
		if (beforeTiming.index !== afterTiming.index || beforeTiming.type !== afterTiming.type) {
			throw new Error(`Before and After action ${index + 1} do not match.`);
		}
		return Math.max(duration(beforeTiming), duration(afterTiming), 100);
	});
}

function synchronizeTimeline(
	input: number,
	prefix: string,
	timings: ActionTiming[],
	replayOffsetMs: number,
	targetDurations: number[],
): { filters: string[]; output: string } {
	const filters: string[] = [];
	const sources = timings.map((_, index) => `[${prefix}Source${index}]`).join('');
	if (timings.length > 1) {
		filters.push(`[${input}:v]split=${timings.length}${sources}`);
	}
	const segments = timings.map((timing, index) => {
		const source = timings.length > 1 ? `[${prefix}Source${index}]` : `[${input}:v]`;
		const segment = `[${prefix}Segment${index}]`;
		const start = seconds(replayOffsetMs + timing.startedAtMs);
		const end = seconds(replayOffsetMs + timing.endedAtMs);
		const rate = targetDurations[index] / duration(timing);
		filters.push(`${source}trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)*${decimal(rate)}${segment}`);
		return segment;
	});
	const output = `[${prefix}Timeline]`;
	filters.push(`${segments.join('')}concat=n=${segments.length}:v=1:a=0${output}`);
	return { filters, output };
}

function duration(timing: ActionTiming): number {
	return Math.max(timing.endedAtMs - timing.startedAtMs, 1);
}

function seconds(milliseconds: number): string {
	return decimal(milliseconds / 1000);
}

function decimal(value: number): string {
	return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function crop(region: CaptureRegion | undefined): string {
	if (!region) {
		return '';
	}
	return `crop=${Math.round(region.width)}:${Math.round(region.height)}:${Math.round(region.x)}:${Math.round(region.y)},`;
}

function escapeDrawText(value: string): string {
	return value
		.replaceAll('\\', '\\\\')
		.replaceAll("'", "\\'")
		.replaceAll(':', '\\:')
		.replaceAll('%', '\\%');
}