# Change Log

All notable changes to the "pr-ui-compare" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

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