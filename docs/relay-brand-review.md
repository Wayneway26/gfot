# Relay mark adoption review — 2026-10-26

Baseline: h2 a13f15b. [Acceptance criteria](relay-brand-spec.md).

## Standards

Review identified an overly broad raster-page svg size selector. It is now limited to body > svg so nested mark dimensions remain explicit. Independent follow-up found no remaining issues. Canonical geometry and clip references were checked.

## Spec

Approved mark is copied exactly; source viewBox and clipping are retained in derived assets. Old palette documentation was updated and explicitly archived. Independent follow-up found no remaining requirements gaps.

## Artifact checks

Electron PNG and an independent rsvg render have identical blue-stroke pixel bounds at 1024px: (333,575,694,791). All ten native ICNS size variants retain the blue finishing stroke. The bundled icon is byte-identical to desktop/assets/icon.icns.

Summary: Standards 1 concern resolved, 0 remaining; Spec documentation updated, 0 remaining.
