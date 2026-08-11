import { spawn } from 'node:child_process';
import * as path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import * as vscode from 'vscode';
import type {
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
	const filter = createFilter(beforeLabel, afterLabel, beforeRegion, afterRegion, layout);
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
	layout: ResolvedComparisonLayout,
): string {
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
	const stack = layout === 'vertical'
		? '[before][after]vstack=inputs=2:shortest=1[stack]'
		: '[before][after]hstack=inputs=2:shortest=1[stack]';
	return [
		`[0:v]${prepare(beforeRegion)},${text(leftLabel, 'left')}[before]`,
		`[1:v]${prepare(afterRegion)},${text(rightLabel, 'right')}[after]`,
		stack,
		'[stack]split[paletteSource][gifSource]',
		'[paletteSource]palettegen=max_colors=128[palette]',
		'[gifSource][palette]paletteuse=dither=bayer[out]',
	].join(';');
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