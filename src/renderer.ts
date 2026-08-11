import { spawn } from 'node:child_process';
import * as path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import * as vscode from 'vscode';
import type {
	ActionTiming,
	CaptureRegion,
	ComparisonLayout,
	LabelAlignment,
	ResizeCue,
	ResolvedComparisonLayout,
	Viewport,
	ZoomCue,
} from './model';

const EXTREME_WIDE_ASPECT_RATIO = 3;
export const DEFAULT_ANIMATION_FRAME_RATE = 24;

export interface RenderedGifs {
	comparisonGifPath: string;
	beforeGifPath: string;
	afterGifPath: string;
}

export interface RenderedImages {
	comparisonImagePath: string;
	beforeImagePath: string;
	afterImagePath: string;
}

export async function renderComparisonImages(
	beforeScreenshotPath: string,
	afterScreenshotPath: string,
	outputDirectory: string,
	beforeLabel: string,
	afterLabel: string,
	viewport: Viewport,
	beforeRegion: CaptureRegion | undefined,
	afterRegion: CaptureRegion | undefined,
	beforeRecordingSize: Viewport,
	afterRecordingSize: Viewport,
	beforeResizeCues: ResizeCue[],
	afterResizeCues: ResizeCue[],
	beforeZoomCues: ZoomCue[],
	afterZoomCues: ZoomCue[],
	borderColor: string,
	beforeLabelAlignment: LabelAlignment,
	afterLabelAlignment: LabelAlignment,
	layoutPreference: ComparisonLayout,
	token: vscode.CancellationToken,
	onOutput: (text: string) => void,
): Promise<RenderedImages> {
	if (!ffmpegPath) {
		throw new Error('No FFmpeg binary is available for this operating system and architecture.');
	}
	const comparisonImagePath = path.join(outputDirectory, 'comparison.png');
	const beforeImagePath = path.join(outputDirectory, 'before.png');
	const afterImagePath = path.join(outputDirectory, 'after.png');
	const layout = resolveComparisonLayout(viewport, beforeRegion, afterRegion, layoutPreference);
	const filter = createImageFilter(
		beforeLabel,
		afterLabel,
		beforeRegion,
		afterRegion,
		beforeRecordingSize,
		afterRecordingSize,
		beforeResizeCues,
		afterResizeCues,
		beforeZoomCues,
		afterZoomCues,
		borderColor,
		beforeLabelAlignment,
		afterLabelAlignment,
		layout,
	);
	const args = [
		'-y',
		'-i', beforeScreenshotPath,
		'-i', afterScreenshotPath,
		'-filter_complex', filter,
		'-map', '[comparisonImageOut]',
		'-frames:v', '1',
		comparisonImagePath,
		'-map', '[beforeImageOut]',
		'-frames:v', '1',
		beforeImagePath,
		'-map', '[afterImageOut]',
		'-frames:v', '1',
		afterImagePath,
	];
	await runFfmpeg(args, token, onOutput);
	return { comparisonImagePath, beforeImagePath, afterImagePath };
}

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
	beforeRecordingSize: Viewport,
	afterRecordingSize: Viewport,
	beforeResizeCues: ResizeCue[],
	afterResizeCues: ResizeCue[],
	beforeZoomCues: ZoomCue[],
	afterZoomCues: ZoomCue[],
	borderColor: string,
	beforeLabelAlignment: LabelAlignment,
	afterLabelAlignment: LabelAlignment,
	frameRate: number,
	layoutPreference: ComparisonLayout,
	token: vscode.CancellationToken,
	onOutput: (text: string) => void,
): Promise<RenderedGifs> {
	if (!ffmpegPath) {
		throw new Error('No FFmpeg binary is available for this operating system and architecture.');
	}
	const comparisonGifPath = path.join(outputDirectory, 'comparison.gif');
	const beforeGifPath = path.join(outputDirectory, 'before.gif');
	const afterGifPath = path.join(outputDirectory, 'after.gif');
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
		beforeRecordingSize,
		afterRecordingSize,
		beforeResizeCues,
		afterResizeCues,
		beforeZoomCues,
		afterZoomCues,
		borderColor,
		beforeLabelAlignment,
		afterLabelAlignment,
		frameRate,
		layout,
	);
	const args = [
		'-y',
		'-i', beforeVideoPath,
		'-i', afterVideoPath,
		'-filter_complex', filter,
		'-map', '[comparisonOut]',
		'-loop', '0',
		comparisonGifPath,
		'-map', '[beforeOut]',
		'-loop', '0',
		beforeGifPath,
		'-map', '[afterOut]',
		'-loop', '0',
		afterGifPath,
	];

	await runFfmpeg(args, token, onOutput);
	return { comparisonGifPath, beforeGifPath, afterGifPath };
}

async function runFfmpeg(
	args: string[],
	token: vscode.CancellationToken,
	onOutput: (text: string) => void,
): Promise<void> {
	if (!ffmpegPath) {
		throw new Error('No FFmpeg binary is available for this operating system and architecture.');
	}
	const executablePath = ffmpegPath;
	await new Promise<void>((resolve, reject) => {
		let encoderOutput = '';
		const child = spawn(executablePath, args, { windowsHide: true });
		child.stdout.on('data', data => onOutput(String(data)));
		child.stderr.on('data', data => {
			encoderOutput = `${encoderOutput}${String(data)}`.slice(-4_000);
			onOutput(String(data));
		});
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
				reject(new Error(`FFmpeg failed with exit code ${code}.\n${encoderOutput.trim()}`));
			}
		});
	});
}

export function resolveComparisonLayout(
	viewport: Viewport,
	beforeRegion: CaptureRegion | undefined,
	afterRegion: CaptureRegion | undefined,
	preference: ComparisonLayout = 'auto',
): ResolvedComparisonLayout {
	if (preference === 'horizontal') {
		return 'horizontal';
	}
	const regions = [beforeRegion, afterRegion].filter((region): region is CaptureRegion => Boolean(region));
	const widestAspectRatio = regions.length > 0
		? Math.max(...regions.map(region => region.width / region.height))
		: viewport.width / viewport.height;
	return widestAspectRatio > EXTREME_WIDE_ASPECT_RATIO ? 'vertical' : 'horizontal';
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
	beforeRecordingSize: Viewport,
	afterRecordingSize: Viewport,
	beforeResizeCues: ResizeCue[],
	afterResizeCues: ResizeCue[],
	beforeZoomCues: ZoomCue[],
	afterZoomCues: ZoomCue[],
	borderColor: string,
	beforeLabelAlignment: LabelAlignment,
	afterLabelAlignment: LabelAlignment,
	frameRate: number,
	layout: ResolvedComparisonLayout,
): string {
	const targetDurations = resolveSynchronizedDurations(beforeTimings, afterTimings);
	const resizeDelayDurations = targetDurations.map((targetDuration, index) => {
		const beforeCue = beforeResizeCues.find(cue => cue.actionIndex === index);
		const afterCue = afterResizeCues.find(cue => cue.actionIndex === index);
		return Math.min(Math.max(beforeCue?.delayMs ?? 0, afterCue?.delayMs ?? 0), targetDuration);
	});
	const resizeTransitionDurations = targetDurations.map((targetDuration, index) => {
		const beforeCue = beforeResizeCues.find(cue => cue.actionIndex === index);
		const afterCue = afterResizeCues.find(cue => cue.actionIndex === index);
		const capturedDuration = Math.max(beforeCue?.durationMs ?? 0, afterCue?.durationMs ?? 0);
		return Math.min(capturedDuration, Math.max(0, targetDuration - resizeDelayDurations[index]));
	});
	const beforeTimeline = synchronizeTimeline(
		0,
		'before',
		beforeTimings,
		beforeReplayOffsetMs,
		targetDurations,
		resizeDelayDurations,
		resizeTransitionDurations,
		beforeRegion,
		beforeRecordingSize,
		layout,
		beforeResizeCues,
		beforeZoomCues,
		borderColor,
		frameRate,
	);
	const afterTimeline = synchronizeTimeline(
		1,
		'after',
		afterTimings,
		afterReplayOffsetMs,
		targetDurations,
		resizeDelayDurations,
		resizeTransitionDurations,
		afterRegion,
		afterRecordingSize,
		layout,
		afterResizeCues,
		afterZoomCues,
		borderColor,
		frameRate,
	);
	const leftLabel = escapeDrawText(beforeLabel);
	const rightLabel = escapeDrawText(afterLabel);
	const border = `pad=iw+6:ih+6:3:3:color=${ffmpegColor(borderColor)}`;
	return [
		...beforeTimeline.filters,
		...afterTimeline.filters,
		`${beforeTimeline.output}${createTextFilter(leftLabel, beforeLabelAlignment)},${border}[beforePane]`,
		`${afterTimeline.output}${createTextFilter(rightLabel, afterLabelAlignment)},${border}[afterPane]`,
		'[beforePane]split=2[beforeForStack][beforeIndividual]',
		'[afterPane]split=2[afterForStack][afterIndividual]',
		layout === 'vertical'
			? '[beforeForStack][afterForStack]vstack=inputs=2:shortest=1[stack]'
			: '[beforeForStack][afterForStack]hstack=inputs=2:shortest=1[stack]',
		'[stack]split[comparisonPaletteSource][comparisonGifSource]',
		'[comparisonPaletteSource]palettegen=max_colors=256[comparisonPalette]',
		'[comparisonGifSource][comparisonPalette]paletteuse=dither=bayer[comparisonOut]',
		'[beforeIndividual]split[beforePaletteSource][beforeGifSource]',
		'[beforePaletteSource]palettegen=max_colors=256[beforePalette]',
		'[beforeGifSource][beforePalette]paletteuse=dither=bayer[beforeOut]',
		'[afterIndividual]split[afterPaletteSource][afterGifSource]',
		'[afterPaletteSource]palettegen=max_colors=256[afterPalette]',
		'[afterGifSource][afterPalette]paletteuse=dither=bayer[afterOut]',
	].join(';');
}

function createTextFilter(label: string, alignment: LabelAlignment): string {
	return [
		`drawtext=text='${label}'`,
		'fontcolor=white',
		'fontsize=22',
		`x=${alignment.endsWith('left') ? '14' : 'w-text_w-14'}`,
		`y=${alignment.startsWith('top') ? '14' : 'h-text_h-14'}`,
		'box=1',
		'boxcolor=black@0.72',
		'boxborderw=7',
	].join(':');
}

function createImageFilter(
	beforeLabel: string,
	afterLabel: string,
	beforeRegion: CaptureRegion | undefined,
	afterRegion: CaptureRegion | undefined,
	beforeRecordingSize: Viewport,
	afterRecordingSize: Viewport,
	beforeResizeCues: ResizeCue[],
	afterResizeCues: ResizeCue[],
	beforeZoomCues: ZoomCue[],
	afterZoomCues: ZoomCue[],
	borderColor: string,
	beforeLabelAlignment: LabelAlignment,
	afterLabelAlignment: LabelAlignment,
	layout: ResolvedComparisonLayout,
): string {
	const beforePane = createStaticPane(
		0,
		'before',
		beforeRegion,
		beforeRecordingSize,
		beforeResizeCues,
		beforeZoomCues,
		borderColor,
		beforeLabel,
		beforeLabelAlignment,
		layout,
	);
	const afterPane = createStaticPane(
		1,
		'after',
		afterRegion,
		afterRecordingSize,
		afterResizeCues,
		afterZoomCues,
		borderColor,
		afterLabel,
		afterLabelAlignment,
		layout,
	);
	return [
		beforePane,
		afterPane,
		'[beforeImagePane]split=2[beforeImageForStack][beforeImageOut]',
		'[afterImagePane]split=2[afterImageForStack][afterImageOut]',
		layout === 'vertical'
			? '[beforeImageForStack][afterImageForStack]vstack=inputs=2[comparisonImageOut]'
			: '[beforeImageForStack][afterImageForStack]hstack=inputs=2[comparisonImageOut]',
	].join(';');
}

function createStaticPane(
	input: number,
	prefix: string,
	region: CaptureRegion | undefined,
	recordingSize: Viewport,
	resizeCues: ResizeCue[],
	zoomCues: ZoomCue[],
	borderColor: string,
	label: string,
	labelAlignment: LabelAlignment,
	layout: ResolvedComparisonLayout,
): string {
	const geometry = resolvePaneGeometry(region, recordingSize, layout);
	const finalResize = resizeCues.at(-1);
	const finalViewport = finalResize?.to ?? recordingSize;
	const resizeMode = finalResize?.resizeMode ?? 'keep-left-edge-fixed';
	const offsetX = resizeMode === 'keep-right-edge-fixed'
		? recordingSize.width - finalViewport.width
		: resizeMode === 'keep-window-centered'
			? (recordingSize.width - finalViewport.width) / 2
			: 0;
	const placement = region
		? crop(region)
		: `pad=${recordingSize.width}:${recordingSize.height}:${Math.round(offsetX)}:0:color=${ffmpegColor(borderColor)}`;
	const finalZoom = zoomCues.at(-1);
	let cameraFilter = '';
	if (finalZoom?.scale && finalZoom.scale > 1 && finalZoom.target) {
		const adjustedCue: ZoomCue = {
			...finalZoom,
			target: {
				...finalZoom.target,
				x: finalZoom.target.x + (region ? 0 : offsetX),
			},
		};
		const camera = resolveCameraState(adjustedCue, geometry);
		cameraFilter = createCameraFilter(camera, camera, 0, geometry.output);
	}
	const escapedLabel = escapeDrawText(label);
	const labelFilter = createTextFilter(escapedLabel, labelAlignment);
	const border = `pad=iw+6:ih+6:3:3:color=${ffmpegColor(borderColor)}`;
	return [
		`[${input}:v]${placement}`,
		'setsar=1',
		cameraFilter,
		`scale=${geometry.output.width}:${geometry.output.height}:flags=lanczos`,
		labelFilter,
		`${border}[${prefix}ImagePane]`,
	].filter(Boolean).join(',');
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
	resizeDelayDurations: number[],
	resizeTransitionDurations: number[],
	region: CaptureRegion | undefined,
	recordingSize: Viewport,
	layout: ResolvedComparisonLayout,
	resizeCues: ResizeCue[],
	zoomCues: ZoomCue[],
	backgroundColor: string,
	frameRate: number,
): { filters: string[]; output: string } {
	const filters: string[] = [];
	const geometry = resolvePaneGeometry(region, recordingSize, layout);
	const resizeCueMap = new Map(resizeCues.map(cue => [cue.actionIndex, cue]));
	const cues = new Map(zoomCues.map(cue => [cue.actionIndex, cue]));
	let viewport = resizeCues[0]?.from ?? recordingSize;
	let resizeMode: ResizeCue['resizeMode'] = 'keep-left-edge-fixed';
	let camera: CameraState = {
		scale: 1,
		centerX: geometry.base.width / 2,
		centerY: geometry.base.height / 2,
	};
	const sources = timings.map((_, index) => `[${prefix}Source${index}]`).join('');
	if (timings.length > 1) {
		filters.push(`[${input}:v]split=${timings.length}${sources}`);
	}
	const segments = timings.map((timing, index) => {
		const source = timings.length > 1 ? `[${prefix}Source${index}]` : `[${input}:v]`;
		const segment = `[${prefix}Segment${index}]`;
		const rawSegment = `[${prefix}RawSegment${index}]`;
		const start = seconds(replayOffsetMs + timing.startedAtMs);
		const end = seconds(replayOffsetMs + timing.endedAtMs);
		const segmentRate = targetDurations[index] / duration(timing);
		const resizeCue = resizeCueMap.get(index);
		const resizeDelayMs = resizeCue ? resizeDelayDurations[index] : 0;
		const resizeTransitionMs = resizeCue ? resizeTransitionDurations[index] : 0;
		if (resizeCue) {
			createSynchronizedResizeSegment(
				filters,
				source,
				rawSegment,
				prefix,
				index,
				start,
				end,
				duration(timing),
				resizeCue.delayMs,
				resizeCue.durationMs,
				targetDurations[index],
				resizeDelayMs,
				resizeTransitionMs,
				frameRate,
			);
		} else {
			const targetFrames = frameCount(targetDurations[index], frameRate);
			filters.push([
				`${source}trim=start=${start}:end=${end}`,
				`setpts=(PTS-STARTPTS)*${decimal(segmentRate)}`,
				`fps=${frameRate}`,
				`tpad=stop_mode=clone:stop=${targetFrames}`,
				`trim=end_frame=${targetFrames}`,
				`setpts=N/(${frameRate}*TB)`,
			].join(',') + rawSegment);
		}
		const placedSegment = region
			? rawSegment
			: createResizePlacementFilters(
				filters,
				rawSegment,
				prefix,
				index,
				viewport,
				resizeCue?.to ?? viewport,
				resizeCue?.resizeMode ?? resizeMode,
				resizeDelayMs,
				resizeTransitionMs,
				targetDurations[index],
				recordingSize,
				backgroundColor,
				frameRate,
			);
		const cue = cues.get(index);
		const cameraOffsetX = region ? 0 : resolveResizeOffset(viewport, resizeMode, recordingSize.width);
		const nextCamera = cue ? resolveCameraState(cue, geometry, cameraOffsetX) : camera;
		const transitionMs = cue
			? Math.min(cue.durationMs, duration(timing)) * segmentRate
			: 0;
		const cameraFilter = createCameraFilter(camera, nextCamera, transitionMs, geometry.output, frameRate);
		const transforms = [
			crop(region),
			'setsar=1',
			cameraFilter,
			`scale=${geometry.output.width}:${geometry.output.height}:flags=lanczos`,
		].filter(Boolean).join(',');
		filters.push(`${placedSegment}${transforms}${segment}`);
		if (resizeCue) {
			viewport = resizeCue.to;
			resizeMode = resizeCue.resizeMode;
		}
		camera = nextCamera;
		return segment;
	});
	const output = `[${prefix}Timeline]`;
	filters.push(`${segments.join('')}concat=n=${segments.length}:v=1:a=0${output}`);
	return { filters, output };
}

function createSynchronizedResizeSegment(
	filters: string[],
	source: string,
	output: string,
	prefix: string,
	index: number,
	startSeconds: string,
	endSeconds: string,
	sourceDurationMs: number,
	sourceDelayMs: number,
	sourceTransitionMs: number,
	targetDurationMs: number,
	targetDelayMs: number,
	targetTransitionMs: number,
	frameRate: number,
): void {
	const leadSourceMs = Math.min(sourceDelayMs, sourceDurationMs);
	const transitionSourceMs = Math.min(sourceTransitionMs, Math.max(0, sourceDurationMs - leadSourceMs));
	const holdSourceMs = Math.max(0, sourceDurationMs - leadSourceMs - transitionSourceMs);
	const leadTargetMs = Math.min(targetDelayMs, targetDurationMs);
	const transitionTargetMs = Math.min(targetTransitionMs, Math.max(0, targetDurationMs - leadTargetMs));
	const holdTargetMs = Math.max(0, targetDurationMs - leadTargetMs - transitionTargetMs);
	const targetFrames = frameCount(targetDurationMs, frameRate);
	const phases = [
		{ name: 'Lead', sourceMs: leadSourceMs, targetMs: leadTargetMs },
		{ name: 'Transition', sourceMs: transitionSourceMs, targetMs: transitionTargetMs },
		{ name: 'Hold', sourceMs: holdSourceMs, targetMs: holdTargetMs },
	].filter(phase => phase.sourceMs > 1 && phase.targetMs > 1);
	if (phases.length === 0) {
		filters.push(`${source}trim=start=${startSeconds}:end=${endSeconds},setpts=PTS-STARTPTS,fps=${frameRate},tpad=stop_mode=clone:stop=${targetFrames},trim=end_frame=${targetFrames},setpts=N/(${frameRate}*TB)${output}`);
		return;
	}
	const phaseSources = phases.map(phase => `[${prefix}Resize${phase.name}Source${index}]`).join('');
	if (phases.length > 1) {
		filters.push(`${source}split=${phases.length}${phaseSources}`);
	}
	let sourceOffsetMs = 0;
	const phaseOutputs = phases.map((phase, phaseIndex) => {
		const phaseSource = phases.length > 1 ? `[${prefix}Resize${phase.name}Source${index}]` : source;
		const phaseOutput = `[${prefix}Resize${phase.name}${index}]`;
		const phaseStart = decimal(Number(startSeconds) + sourceOffsetMs / 1000);
		sourceOffsetMs += phase.sourceMs;
		const phaseEnd = decimal(Number(startSeconds) + sourceOffsetMs / 1000);
		filters.push(`${phaseSource}trim=start=${phaseStart}:end=${phaseEnd},setpts=(PTS-STARTPTS)*${decimal(phase.targetMs / phase.sourceMs)}${phaseOutput}`);
		return phaseOutput;
	});
	filters.push(`${phaseOutputs.join('')}concat=n=${phaseOutputs.length}:v=1:a=0,fps=${frameRate},tpad=stop_mode=clone:stop=${targetFrames},trim=end_frame=${targetFrames},setpts=N/(${frameRate}*TB)${output}`);
}

function frameCount(milliseconds: number, frameRate: number): number {
	return Math.max(1, Math.round(milliseconds * frameRate / 1000));
}

function resolveResizeOffset(viewport: Viewport, resizeMode: ResizeCue['resizeMode'], recordingWidth: number): number {
	const slack = recordingWidth - viewport.width;
	return resizeMode === 'keep-right-edge-fixed' ? slack : resizeMode === 'keep-window-centered' ? slack / 2 : 0;
}

function createResizePlacementFilters(
	filters: string[],
	input: string,
	prefix: string,
	index: number,
	start: Viewport,
	end: Viewport,
	resizeMode: ResizeCue['resizeMode'],
	delayMs: number,
	transitionMs: number,
	segmentDurationMs: number,
	recordingSize: Viewport,
	backgroundColor: string,
	frameRate: number,
): string {
	if (resizeMode === 'keep-left-edge-fixed' && start.width === recordingSize.width && end.width === recordingSize.width) {
		return input;
	}
	const transitionSeconds = transitionMs / 1000;
	const delaySeconds = delayMs / 1000;
	const progress = transitionSeconds <= 0 ? '1' : `max(0,min(1,(t-${decimal(delaySeconds)})/${decimal(transitionSeconds)}))`;
	const eased = `(0.5-0.5*cos(PI*${progress}))`;
	const width = interpolate(start.width, end.width, eased);
	const height = interpolate(start.height, end.height, eased);
	const slack = `${recordingSize.width}-(${width})`;
	const offset = resizeMode === 'keep-right-edge-fixed' ? slack : resizeMode === 'keep-window-centered' ? `(${slack})/2` : '0';
	const rightMask = `[${prefix}RightMask${index}]`;
	const bottomMask = `[${prefix}BottomMask${index}]`;
	const rightCleaned = `[${prefix}RightCleaned${index}]`;
	const cleaned = `[${prefix}Cleaned${index}]`;
	const output = `[${prefix}Placed${index}]`;
	const color = `color=c=${ffmpegColor(backgroundColor)}:s=${recordingSize.width}x${recordingSize.height}:r=${frameRate}:d=${seconds(segmentDurationMs)}`;
	filters.push(`${color}${rightMask}`);
	filters.push(`${input}${rightMask}overlay=x='${width}':y=0:eval=frame:shortest=1${rightCleaned}`);
	filters.push(`${color}${bottomMask}`);
	filters.push(`${rightCleaned}${bottomMask}overlay=x=0:y='${height}':eval=frame:shortest=1${cleaned}`);
	filters.push([
		`${cleaned}pad=${recordingSize.width * 2}:${recordingSize.height}:${recordingSize.width}:0:color=${ffmpegColor(backgroundColor)}`,
		`crop=${recordingSize.width}:${recordingSize.height}:x='${recordingSize.width}-(${offset})':y=0`,
	].join(',') + output);
	return output;
}

interface CameraState {
	scale: number;
	centerX: number;
	centerY: number;
}

interface PaneGeometry {
	base: CaptureRegion;
	output: Viewport;
}

function resolvePaneGeometry(
	region: CaptureRegion | undefined,
	recordingSize: Viewport,
	layout: ResolvedComparisonLayout,
): PaneGeometry {
	const base = region ?? { x: 0, y: 0, width: recordingSize.width, height: recordingSize.height };
	if (layout === 'vertical') {
		const width = 960;
		return { base, output: { width, height: even(base.height * width / base.width) } };
	}
	const height = 360;
	return { base, output: { width: even(base.width * height / base.height), height } };
}

function resolveCameraState(cue: ZoomCue, geometry: PaneGeometry, offsetX = 0): CameraState {
	if (cue.scale === 1 || !cue.target) {
		return {
			scale: 1,
			centerX: geometry.base.width / 2,
			centerY: geometry.base.height / 2,
		};
	}
	const targetCenterX = cue.target.x + cue.target.width / 2;
	const targetCenterY = cue.target.y + cue.target.height / 2;
	return {
		scale: cue.scale,
		centerX: targetCenterX - geometry.base.x + offsetX,
		centerY: targetCenterY - geometry.base.y,
	};
}

function createCameraFilter(
	start: CameraState,
	end: CameraState,
	transitionMs: number,
	output: Viewport,
	frameRate = DEFAULT_ANIMATION_FRAME_RATE,
): string {
	if (start.scale === 1 && end.scale === 1) {
		return '';
	}
	const frames = Math.max(1, Math.round(transitionMs * frameRate / 1000));
	const progress = frames <= 1 ? '1' : `min(1,on/${frames - 1})`;
	const eased = `(0.5-0.5*cos(PI*${progress}))`;
	const zoom = interpolate(start.scale, end.scale, eased);
	const centerX = interpolate(start.centerX, end.centerX, eased);
	const centerY = interpolate(start.centerY, end.centerY, eased);
	return [
		`zoompan=z='${zoom}'`,
		`x='max(0,min(iw-iw/zoom,${centerX}-iw/(2*zoom)))'`,
		`y='max(0,min(ih-ih/zoom,${centerY}-ih/(2*zoom)))'`,
		'd=1',
		`s=${output.width}x${output.height}`,
		`fps=${frameRate}`,
	].join(':');
}

function interpolate(start: number, end: number, progress: string): string {
	if (start === end) {
		return decimal(start);
	}
	return `${decimal(start)}+(${decimal(end - start)})*${progress}`;
}

function even(value: number): number {
	const rounded = Math.max(2, Math.round(value));
	return rounded % 2 === 0 ? rounded : rounded + 1;
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
	return `crop=${Math.round(region.width)}:${Math.round(region.height)}:${Math.round(region.x)}:${Math.round(region.y)}`;
}

function ffmpegColor(value: string): string {
	return `0x${value.slice(1)}`;
}

function escapeDrawText(value: string): string {
	return value
		.replaceAll('\\', '\\\\')
		.replaceAll("'", "\\'")
		.replaceAll(':', '\\:')
		.replaceAll('%', '\\%');
}