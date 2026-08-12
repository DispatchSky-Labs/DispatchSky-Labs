# Changelog

## 2026-08-11

### Fixed

- Fixed `/edct` lookups timing out as the monitored destination set expanded.
- Parallelized source fetches during bulk lookup and watched-flight refresh so one destination no longer waits for every other destination to finish.
- Preserved ordered EDCT state updates, event deduplication, and notification generation after source fetches complete.

### Validation

- `npm test`: 41 passing
- Added a regression assertion confirming concurrent destination fetches in bulk lookup.
- Sadiom Flow files and behavior were not changed.
