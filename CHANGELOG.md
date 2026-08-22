# Change Log

All notable changes to the "pr-ui-compare" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- Made the MCP server usable from a single configuration across repositories. `create_comparison` accepts an optional `workspacePath`, `PR_UI_COMPARE_WORKSPACE` sets a default, and `--workspace` still wins.
- The MCP server now returns server instructions at initialization, so clients that read that field, such as Claude Code and Codex, get the guidance the extension contributes to VS Code chat as skills and instructions.
- The MCP server now sends progress notifications for calls that carry a progress token, so a multi-minute comparison reports its stage instead of looking idle.
- Trimmed the tool description to 1929 bytes and kept the server instructions under 2KB, because Claude Code truncates both at 2KB.
- Browser launch failures now quote a host-appropriate installation hint instead of naming a VS Code command in every client.
- Added `npm run test:mcp` for the MCP stdio smoke test, which now covers `workspacePath` and progress notifications.

- Added optional `scenario.setupActions` for navigation, interactions, waits, and settling that must finish before an animated GIF begins. Setup replays on both sides before focus sampling and synchronization, and is omitted from the rendered timeline.
- Added an MCP server so the same engine works outside VS Code. `npx pr-ui-compare` starts a stdio server exposing `create_comparison`, `install_browser`, and `install_ffmpeg`, with the tool schema shared with the extension. Artifacts go under `~/.pr-ui-compare`, configurable with `PR_UI_COMPARE_STORAGE_DIR`.
- Decoupled the engine modules from the VS Code API behind a small host abstraction. Extension behavior is unchanged.

## [0.1.5] - 2026-08-12

- Swapped the README demo GIF for a toolbar breakpoint recording and added a static PNG comparison example to the image mode explanation.

## [0.1.4] - 2026-08-12

- Cut the feature list down to short fragments, moved Requirements directly after Features, and added a numbered Setup section covering the Install Managed Chromium and Install FFmpeg commands.

## [0.1.3] - 2026-08-12

- Added a demo comparison GIF to the README so the output is visible before installing.
- Shortened every feature bullet and moved the motivation into its own section, so the listing reads quickly.

## [0.1.2] - 2026-08-12

- Rewrote the README introduction in direct language. It now opens with what the extension produces, states plainly that the app is started and recorded from both versions, and drops the indirect phrasing.

## [0.1.1] - 2026-08-12

- Rewrote the README introduction so the purpose and the pain it removes come across right away instead of after several paragraphs of mechanics.
- Replaced the agent prompt examples with natural requests. Users say something like "make a comparison gif of this dropdown fix against main", they do not name the extension, so the examples now show what people actually type.
- Removed the stale reference to the deleted per-platform packaging script from the development section.

## [0.1.0] - 2026-08-11

- Stopped bundling the FFmpeg binary. FFmpeg now resolves from the `prUiCompare.ffmpegPath` setting, then PATH, then a copy downloaded on demand by the new **PR UI Compare: Install FFmpeg** command, mirroring the managed Chromium flow. This removes the non-redistributable binary from the package and shrinks the VSIX.
- Bundled the Noto Sans font and passed it to FFmpeg's drawtext explicitly, so labels render identically on Windows, Linux, and macOS instead of depending on fontconfig defaults.

## [0.0.20] - 2026-08-11

- Recommended a label format in the tool schema, skill, and instructions. Agents are pointed at `Before • main` and `After • fix-overflow`, which render with the short SHA appended, and are told never to write a SHA themselves. A label the user states explicitly is still passed through unchanged.

## [0.0.19] - 2026-08-11

- Allowed scenario actions in static image mode, so any settled state can be photographed, not just the initial route. The actions replay identically in both versions as setup, then a single PNG captures the final state, which covers elements that only exist after loading a document or opening a panel.
- Left the synthetic pointer out of static images so a setup click does not leave a stray cursor dot in the screenshot.
- Narrowed the tool description, skill, and instructions to requests for generated media. Asking an agent to compare a branch against `main`, review a fix, or summarize what changed is a code question and no longer reads as a reason to record the application.

## [0.0.18] - 2026-08-11

- Captured resize transitions in stop-motion by default: every output frame is taken at an exact viewport size, so fixed edges stay perfectly rigid and both panes resize in exact lockstep. Live recording remains available per resize with `captureStrategy: "live"`.
- Aligned both recordings to a shared time origin with a pre-scenario sync beacon, removing the constant offset between video start and scenario timestamps.
- Scaled label size with the output dimensions so labels look consistent when artifacts are displayed at the same width, and added an explicit `labelSize` option for user-requested sizes.
- Reported each resize as a plain-language `resizeOutcomes` sentence in the tool result and the pre-run confirmation so agents can verify the fixed edge before and after running.
- Masked stale content below the viewport during height-only shrinks with `keep-left-edge-fixed`.

## [0.0.17] - 2026-08-11

- Synchronized resize lead-in, viewport movement, and hold phases separately so capture-time differences cannot shift either edge.
- Normalized every paired action to an exact shared frame count before concatenation.
- Enforced side-by-side layout for focused regions at or below 3:1, including legacy explicit vertical requests.
- Added an adversarial Playwright check that compares both page boundaries on every frame for both one-sided resize modes.

## [0.0.16] - 2026-08-11

- Synchronized Before and After resize placement with one shared transition duration, even when their measured action runtimes differ.
- Raised the rendered label size to a 22-pixel readability floor for GIF and PNG output.
- Added multi-frame edge synchronization checks for every resize mode and a rendered label glyph-height check.

## [0.0.15] - 2026-08-11

- Replaced directional resize configuration with `keep-left-edge-fixed`, `keep-right-edge-fixed`, and `keep-window-centered` outcomes so agents can match the requested invariant directly.
- Kept older `movingEdge` and `anchor` scenarios compatible without exposing those ambiguous fields to agents.

## [0.0.14] - 2026-08-11

- Replaced the ambiguous agent-facing resize anchor with a required `movingEdge` value for left, right, or simultaneous movement.
- Synchronized viewport masking and placement by timestamp so the fixed edge cannot drift during a resize.
- Added motion-level pixel checks for fixed-left, fixed-right, and horizontally centered resize behavior.

## [0.0.13] - 2026-08-11

- Corrected left, right, and centered resize placement by isolating the live viewport from Playwright's blank recording area.

## [0.0.12] - 2026-08-11

- Increased animation and camera zoom rendering to 24 fps for smoother motion.
- Made GIF-first discovery explicit, with static PNG retained only as a narrow motionless exception.
- Added agent-configurable animation frame rates from 5 to 30 fps.
## [0.0.11] - 2026-08-11

- Made animation the conservative default and restricted image mode to action-free, truly static comparisons.
- Improved zoom sharpness by applying camera crops before final scaling and using full GIF palettes.
## [0.0.10] - 2026-08-11

- Added common and per-side Light, Dark, and System browser color-scheme emulation.
## [0.0.9] - 2026-08-11

- Added final-state static PNG comparisons with combined, Before, and After image outputs.
## [0.0.8] - 2026-08-10

- Kept the synthetic pointer hidden until the first pointer interaction.

## [0.0.7] - 2026-08-10

- Added left, right, and centered resize anchoring plus configurable border color and label corners.

## [0.0.6] - 2026-08-10

- Added smooth, persistent camera zoom actions with element targeting and eased zoom-out.
## [0.0.5] - 2026-08-10

- Added separate synchronized Before and After GIF artifacts and three-file export.
## [0.0.4] - 2026-08-10

- Synchronized Before and After recordings at every action boundary.
- Added pane borders and short commit IDs to comparison labels.

## [0.0.3] - 2026-08-10

- Prevented agents from falling back to generated Playwright scripts or repository edits when the comparison tool is unavailable.

## [0.0.2] - 2026-08-10

- Added baseline Git ref versus current workspace comparisons.
- Added focused element tracking and cropping throughout Playwright scenarios.
- Added side-by-side layout with automatic vertical stacking for extremely wide regions.
- Added visible Before and After labels inside the outer corners of each recording.
- Added animated viewport resize actions for demonstrating breakpoint transitions and other dimension-dependent UI behavior.
- Added managed Chromium installation so macOS does not need to launch an app from `/Applications`.
- Added VS Code preview, GIF export, Agent Skill, language model tool, and session cleanup.
- Added unit, renderer, and complete browser pipeline tests.