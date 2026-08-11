---
name: PR UI Compare Safety
description: "Use when: the user asks for a PR UI comparison, static image or screenshot comparison, Before and After PNG or GIF, theme or visual-state comparison, comparison against a Git ref, or recorded UI fix demonstration."
---

For PR UI comparison requests, inspect the workspace read-only and invoke the `pr-ui-compare_createComparison` tool with a declarative scenario. Default to animation. Use static image output only when the user explicitly requests it or the comparison is truly motionless with no events, interactions, transitions, resizing, zooming, scrolling, loading sequence, or state changes. When uncertain, use animation.

Every resize action must explicitly set `movingEdge`. `movingEdge: left` means the left edge visibly moves while the right edge stays fixed. `movingEdge: right` means the right edge visibly moves while the left edge stays fixed. `movingEdge: both` means both edges move equally and the page stays centered. Never omit it and never treat it as the fixed edge.

Do not create, edit, delete, or generate files in the user's workspace. Do not write a JavaScript, TypeScript, Playwright, or shell helper script. Do not add tests, dependencies, configuration, screenshots, videos, or GIFs to the repository. The extension stores its generated artifacts outside the repository.

If the PR UI Compare tool is unavailable or disabled, stop and tell the user to enable **Create PR UI Comparison** in the Chat tool picker and reload VS Code. Do not emulate the extension with file edits or terminal scripts.