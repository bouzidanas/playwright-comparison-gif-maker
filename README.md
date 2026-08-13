# PR UI Compare

Show the fix instead of describing it. PR UI Compare records your app before and after a change and turns the two recordings into one labeled, side-by-side GIF or PNG that you can use for your PR.

Ask your agent for a comparison gif. The extension starts your app twice, once from your working tree and once from the branch or commit you name, plays the same clicks, scrolls, and resizes through both in a headless browser, and renders the recordings side by side in perfect sync. Drag the result straight into the PR description.

![A PR UI Compare GIF showing Before and After recordings side by side](assets/demo-comparison.gif)

## Features

- Baseline pinned to an exact commit SHA
- Before side built in a temporary Git worktree
- Repository and workspace never modified
- One Playwright scenario replayed in both versions
- Paired actions begin and end in lockstep
- Side-by-side layout, stacked for very wide focus regions
- Optional crop that follows a chosen element
- Synthetic pointer shown only during clicks and hovers
- Static PNG mode for settled states
- Framed panes labeled with short commit IDs
- Combined GIF plus synchronized Before and After GIFs
- Recordings kept in VS Code storage
- Ships the `/create-pr-ui-comparison` Agent Skill and `#createPrUiComparison` tool

## Requirements

- VS Code 1.125 or later
- A trusted local Git workspace
- The package manager and runtime required by the application
- Playwright-managed Chromium
- FFmpeg

## Setup

1. Install the extension.
2. Run **PR UI Compare: Install Managed Chromium** from the Command Palette.
3. Run **PR UI Compare: Install FFmpeg**, unless FFmpeg is already on PATH or set in `prUiCompare.ffmpegPath`.
4. Open and trust the workspace you want to record.

The headless browser shell is stored in Playwright's user cache. Each Playwright version requires a matching browser revision, but the extension does not install the larger headed Chromium build or launch Google Chrome from `/Applications` by default.

FFmpeg is resolved from the `prUiCompare.ffmpegPath` setting first, then from PATH, then from the copy the install command downloads into the extension's global storage. Labels are drawn with the bundled Noto Sans font so output looks the same on every platform.

## Motivation

Recording this by hand is tedious. Check out the old code, start the app, record, switch back, record again, edit the recordings, stitch them together, and yet, the two clips still never line up. With PR UI Compare it is one request, the recordings play in lockstep, and nothing in your repository is created or modified.

"Before" can be any branch, tag, or commit SHA. "After" is always your working tree exactly as it is, uncommitted edits included. Animated GIF is the default output. Ask for an image for things that are static or finished changing, and setup interactions can run first so a single PNG captures the settled state. And note that this extension is for producing visual artifacts. Agents should know not to use this for code comparison questions.

The workflow is short. Make a visible UI change, generate the comparison, review it in VS Code, then drop the exported GIF into the GitHub PR description. An open pull request is not required.

## Agent usage

Ask Copilot in plain language. Mention whether you want a gif or an image, the change you want to see, and what to compare against:

```text
Make a comparison gif of this dropdown fix against main.
```

```text
I want a before and after image comparing the new card styling to what's on main.
```

The agent picks the tool up from the request. It does not need the extension named, and it works out the start command, readiness URL, and scenario actions by inspecting the project.

The agent sets `outputMode` to `image` for an explicit static request or when the subject is a settled state that holds still. Image mode accepts scenario actions, and they run as setup rather than as the subject. Both versions replay the same actions, then a single PNG captures the settled final state, so a panel that only appears after loading a document or opening an editor can still be compared as a still image. Use animation when the change the user needs to see is the motion itself, such as a transition, loading sequence, resize, zoom, or scroll. When the request is ambiguous, animation is always the default. The synthetic pointer is not drawn in static images.

![A static PNG comparison of a focused UI region in both versions](assets/demo-image-comparison.png)

Animated GIF frame rate is configurable from 5 to 30 fps and defaults to 24. Use 30 fps for fast visual events, short transitions, or detailed camera movement. Lower rates reduce file size for slow and simple motion. Static image mode does not accept frame rate.

Use `colorScheme` to load both browser contexts in `light`, `dark`, or `system` mode. It emulates `prefers-color-scheme` before navigation so pages initialize in the requested appearance. For a direct light-versus-dark image, set `beforeColorScheme` and `afterColorScheme` independently:

```json
{
	"outputMode": "image",
	"beforeColorScheme": "light",
	"afterColorScheme": "dark"
}
```

Per-side values override `colorScheme`. The default is `system`, which disables explicit color-scheme emulation.

The contributed skill tells the agent to inspect project scripts and lockfiles, choose stable Playwright locators, keep the scenario short, and request confirmation before project commands run.

The workflow does not create or modify files in the target repository. Agents should inspect the project read-only and pass a declarative scenario directly to the extension tool. If the tool is disabled or unavailable, the agent should stop and ask the user to enable it rather than generate a Playwright helper script.

Set `focusLocator` for a stable region such as `role=navigation`, `data-testid=menu-bar`, or `#settings-panel`. Auto layout remains side by side for ordinary desktop and mobile captures. A region such as a full-width menu bar switches to top and bottom only when its aspect ratio is greater than 3:1. An exact 3:1 region remains side by side.

Supported actions are `goto`, `click`, `hover`, `fill`, `press`, `scroll`, `resize`, `zoom`, `waitFor`, and `hold`. Use locator strings such as `role=button[name="Menu"]`, `text=Settings`, and `data-testid=profile-panel`.

Zoom is a recording-camera effect and does not change page layout, browser zoom, or interaction coordinates. It smoothly moves toward a target element and remains active for following actions until another zoom changes it. Use scale `1` without a locator to return to the full frame:

```json
[
	{ "type": "zoom", "locator": "role=toolbar", "scale": 1.8, "durationMs": 900, "holdAfterMs": 400 },
	{ "type": "click", "locator": "role=button[name=\"More actions\"]", "holdAfterMs": 1000 },
	{ "type": "zoom", "scale": 1, "durationMs": 900, "holdAfterMs": 400 }
]
```

Camera movement uses cosine easing for a smooth arrival and departure. Moderate scales and short holds help viewers orient without making the comparison feel busy.

`borderColor` accepts a six-digit hex color and defaults to GitHub dark border `#30363d`. It colors each pane frame, the divider, and unused canvas exposed by resize movement. `beforeLabelAlignment` and `afterLabelAlignment` accept `top-left`, `top-right`, `bottom-left`, or `bottom-right`. Their defaults are `top-left` for Before and `top-right` for After. Labels use a renderer-owned 22-pixel minimum size so agents cannot produce unreadably small text.

Use resize actions whenever viewport dimensions are part of the behavior being demonstrated. This includes breakpoint changes, fluid reflow, text wrapping, overflow, sticky or fixed positioning, viewport units, resize observers, canvas sizing, sidebars, and layout stability. Resize is optional and should not be added to unrelated comparisons.

A resize action animates the page viewport while the recording canvas remains fixed at the largest dimensions used by the scenario. The sizes do not need to cross a CSS breakpoint:

```json
[
	{ "type": "hold", "durationMs": 500 },
	{ "type": "resize", "width": 390, "height": 844, "resizeMode": "keep-right-edge-fixed", "durationMs": 800, "holdAfterMs": 1200 },
	{ "type": "resize", "width": 1280, "height": 720, "resizeMode": "keep-right-edge-fixed", "durationMs": 800, "holdAfterMs": 800 }
]
```

Set `resizeMode` on every resize action. Each value directly names the invariant:

- `resizeMode: "keep-left-edge-fixed"` allows only the right edge to move.
- `resizeMode: "keep-right-edge-fixed"` allows only the left edge to move.
- `resizeMode: "keep-window-centered"` moves both edges simultaneously at the same rate.

For example, use `keep-right-edge-fixed` when shrinking must slide the left edge right without moving the right edge. Older `movingEdge` and `anchor` payloads remain accepted for compatibility but are no longer exposed to agents.

For breakpoint fixes, start on one side of the breakpoint and cross it during the recording rather than showing only a fixed mobile or desktop state.

## Manual usage

Run **PR UI Compare: Create PR UI Comparison** from the Command Palette. The wizard first asks for animated versus static output and System, Light, or Dark browser appearance, then asks for the baseline ref, start command, readiness URL, optional baseline install command, route, optional focus locator, and scenario actions as JSON.

Use `{port}` in commands and URLs:

```text
npm run dev -- --port {port}
http://127.0.0.1:{port}
```

The manual wizard defaults to a two-second static recording. Agent usage is preferred for interaction scenarios.

## MCP server

The same engine runs outside VS Code as an MCP server, so clients such as Claude Code, Cursor, and Zed can create comparisons too. The server speaks stdio and exposes three tools: `create_comparison` (same schema as the VS Code tool), `install_browser`, and `install_ffmpeg`.

```json
{
	"servers": {
		"pr-ui-compare": {
			"command": "npx",
			"args": ["-y", "pr-ui-compare", "--workspace", "/path/to/your/repo"]
		}
	}
}
```

Without `--workspace`, the server compares the repository at its working directory. Artifacts are written under `~/.pr-ui-compare` and never into the repository; `PR_UI_COMPARE_STORAGE_DIR` overrides the location and `PR_UI_COMPARE_RETENTION_DAYS` controls cleanup (default 7). `PR_UI_COMPARE_FFMPEG` points at a specific FFmpeg build, and `PR_UI_COMPARE_ALLOW_SYSTEM_BROWSER=1` enables the Chrome and Edge fallback. One difference from the extension: confirmation prompts belong to the MCP client, so the server runs the start and install commands it is given.

## Storage

Raw captures, timing metadata, and rendered GIF or PNG files are written under VS Code workspace storage. They do not appear in Source Control. The preview exports the combined, Before, and After artifacts together.

`prUiCompare.retentionDays` keeps temporary sessions for 1 to 90 days. The default is 7 days.

`prUiCompare.allowSystemBrowser` enables Google Chrome or Microsoft Edge fallback. It is disabled by default. On macOS, leaving it disabled avoids App Management warnings caused when a VS Code child process launches an application from the system Applications folder.

## Current limitations

- The After side is always the current working tree. To compare two commits or two branches, check one of them out and name the other as the baseline. Naming both sides in one request is not supported yet.
- Firefox and WebKit are not supported yet.
- Playback is synchronized by action segment. Sequential playback is not exposed yet.
- GitHub attachment upload remains manual. Save the GIF and drag it into the PR editor.
- Authentication, database fixtures, environment files, and backend state remain project-specific.
- Git submodule worktrees and Git LFS projects may require additional setup.

## Development

```sh
npm install
npm run compile
npm test
npm run test:e2e
npx vsce package
```

`npm test` runs model and renderer tests in a VS Code extension host. `npm run test:e2e` additionally uses managed Chromium to run the complete Git worktree, server, Playwright, FFmpeg, metadata, and cleanup pipeline. `node scripts/mcp-e2e-smoke.js` drives the built MCP server against a fixture repository over stdio.

Press `F5` to open an Extension Development Host.

## Architecture

This is intentionally one repository and one package with two thin shells over one engine: the VS Code extension and the MCP server. The engine modules depend on a small host abstraction instead of the VS Code API.

- `src/comparisonRunner.ts` coordinates sessions and cleanup.
- `src/gitRepository.ts` resolves refs and manages detached worktrees.
- `src/processes.ts` owns commands, servers, ports, and readiness checks.
- `src/capture.ts` tracks focus bounds and records Playwright scenarios.
- `src/renderer.ts` selects layout, crops recordings, adds labels, and creates GIFs.
- `src/host.ts` defines the engine-facing host interfaces.
- `src/previewPanel.ts` provides review and export inside VS Code.
- `src/compareTool.ts` exposes the runner to agents in VS Code.
- `src/mcpServer.ts` exposes the runner to MCP clients over stdio.
- `skills/create-pr-ui-comparison/` teaches agents the pre-PR workflow.

## Security

The extension requires Workspace Trust because install and start commands execute project code. Agent tool invocations show the baseline ref and commands before execution. Webview content uses a restrictive content security policy and can only load generated session resources.

## License

PR UI Compare is open-source software available under the [MIT License](LICENSE).
