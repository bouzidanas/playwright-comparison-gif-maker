# PR UI Compare

PR UI Compare creates a labeled Before and After GIF for a pull request by replaying the same Playwright scenario against a baseline Git revision and the current working tree.

The intended workflow is straightforward. Implement and test a visible UI change, commit and push when the final artifact is needed, generate the comparison, review it in VS Code, then drag the exported GIF into the GitHub PR description. An open pull request is not required.

## Features

- Resolves the selected baseline ref to an immutable commit SHA.
- Creates a detached temporary Git worktree without changing the current workspace.
- Starts Before and After applications sequentially on separate dynamic ports.
- Replays one declarative Playwright scenario against both applications.
- Keeps the synthetic pointer out of view unless a click or hover action uses it.
- Tracks an optional focused element throughout the scenario and crops to its padded bounds.
- Keeps normal comparisons side by side.
- Automatically stacks top and bottom only when a focused region is at least three times wider than tall.
- Synchronizes each paired action segment so interactions and resize transitions begin and end together even when the two application versions respond at different speeds.
- Renders a visible frame and divider around the two recordings.
- Renders labels inside the outer top corners with short commit IDs, such as `main (a1b2c3d4)` and `fix-toolbar (e5f6a7b8)`.
- Saves synchronized `before.gif` and `after.gif` files beside `comparison.gif` and exports all three together.
- Stores recordings in VS Code workspace storage rather than the repository.
- Contributes the `/create-pr-ui-comparison` Agent Skill and `#createPrUiComparison` tool.

## Requirements

- VS Code 1.125 or later
- A trusted local Git workspace
- The package manager and runtime required by the application
- Playwright-managed Chromium

Run **PR UI Compare: Install Managed Chromium** once after installing the extension. The headless browser shell is stored in Playwright's user cache. Each Playwright version requires a matching browser revision, but the extension does not install the larger headed Chromium build or launch Google Chrome from `/Applications` by default.

PR UI Compare packages FFmpeg, so a separate media encoder is not required.

## Agent usage

Ask Copilot something similar to:

```text
Create a PR UI comparison that demonstrates the mobile menu fix against upstream/main.
```

The contributed skill tells the agent to inspect project scripts and lockfiles, choose stable Playwright locators, keep the scenario short, and request confirmation before project commands run.

The workflow does not create or modify files in the target repository. Agents should inspect the project read-only and pass a declarative scenario directly to the extension tool. If the tool is disabled or unavailable, the agent should stop and ask the user to enable it rather than generate a Playwright helper script.

Set `focusLocator` for a stable region such as `role=navigation`, `data-testid=menu-bar`, or `#settings-panel`. Auto layout remains side by side for ordinary desktop and mobile captures. A region such as a full-width menu bar switches to top and bottom when its aspect ratio reaches 3:1.

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

`borderColor` accepts a six-digit hex color and defaults to GitHub dark border `#30363d`. It colors each pane frame, the divider, and unused canvas exposed by anchored resizing. `beforeLabelAlignment` and `afterLabelAlignment` accept `top-left`, `top-right`, `bottom-left`, or `bottom-right`. Their defaults are `top-left` for Before and `top-right` for After.

Use resize actions whenever viewport dimensions are part of the behavior being demonstrated. This includes breakpoint changes, fluid reflow, text wrapping, overflow, sticky or fixed positioning, viewport units, resize observers, canvas sizing, sidebars, and layout stability. Resize is optional and should not be added to unrelated comparisons.

A resize action animates the page viewport while the recording canvas remains fixed at the largest dimensions used by the scenario. The sizes do not need to cross a CSS breakpoint:

```json
[
	{ "type": "hold", "durationMs": 500 },
	{ "type": "resize", "width": 390, "height": 844, "durationMs": 800, "holdAfterMs": 1200 },
	{ "type": "resize", "width": 1280, "height": 720, "durationMs": 800, "holdAfterMs": 800 }
]
```

Set `anchor` on a resize action to control where the page sits in that fixed canvas:

- `right` keeps the left edge fixed while the right edge moves. This is the default.
- `left` keeps the right edge fixed while the left edge moves.
- `both` moves both edges equally so the page remains centered.

For breakpoint fixes, start on one side of the breakpoint and cross it during the recording rather than showing only a fixed mobile or desktop state.

## Manual usage

Run **PR UI Compare: Create PR UI Comparison** from the Command Palette. The wizard asks for the baseline ref, start command, readiness URL, optional baseline install command, route, optional focus locator, and scenario actions as JSON.

Use `{port}` in commands and URLs:

```text
npm run dev -- --port {port}
http://127.0.0.1:{port}
```

The manual wizard defaults to a two-second static recording. Agent usage is preferred for interaction scenarios.

## Storage

Raw videos, timing metadata, and rendered GIFs are written under VS Code workspace storage. They do not appear in Source Control. The preview provides **Save GIFs As...** and **Reveal Session** controls.

`prUiCompare.retentionDays` keeps temporary sessions for 1 to 90 days. The default is 7 days.

`prUiCompare.allowSystemBrowser` enables Google Chrome or Microsoft Edge fallback. It is disabled by default. On macOS, leaving it disabled avoids App Management warnings caused when a VS Code child process launches an application from the system Applications folder.

## Current limitations

- The extension currently compares one baseline Git ref with the current workspace.
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
npm run package:vsix
```

`npm test` runs model and renderer tests in a VS Code extension host. `npm run test:e2e` additionally uses managed Chromium to run the complete Git worktree, server, Playwright, FFmpeg, metadata, and cleanup pipeline.

Press `F5` to open an Extension Development Host.

## Architecture

This is intentionally one repository and one extension package. The recording engine is split into internal modules so a CLI or MCP adapter can reuse it later without introducing a monorepo before there is a second shipped package.

- `src/comparisonRunner.ts` coordinates sessions and cleanup.
- `src/gitRepository.ts` resolves refs and manages detached worktrees.
- `src/processes.ts` owns commands, servers, ports, and readiness checks.
- `src/capture.ts` tracks focus bounds and records Playwright scenarios.
- `src/renderer.ts` selects layout, crops recordings, adds labels, and creates GIFs.
- `src/previewPanel.ts` provides review and export inside VS Code.
- `src/compareTool.ts` exposes the runner to agents.
- `skills/create-pr-ui-comparison/` teaches agents the pre-PR workflow.

## Security

The extension requires Workspace Trust because install and start commands execute project code. Agent tool invocations show the baseline ref and commands before execution. Webview content uses a restrictive content security policy and can only load generated session resources.

## License

PR UI Compare is open-source software available under the [MIT License](LICENSE).
