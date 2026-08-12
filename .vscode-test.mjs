import { defineConfig } from '@vscode/test-cli';
import ffmpegPath from 'ffmpeg-static';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	env: { PR_UI_COMPARE_FFMPEG: ffmpegPath ?? '' },
});
