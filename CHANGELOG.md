# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-05-08

### Added

- Bilingual README (English + Chinese) with architecture diagram, CLI reference, and demo GIF.
- MIT license.
- Local state example file (`state.example.json`).
- `--group` flag for targeting a specific group from the CLI.
- macOS LaunchAgent installer for the background card service.
- GitHub Actions CI with lint and test.
- ESLint configuration.
- Contributing guide and issue template.

### Changed

- Renamed all internal `cc` references to `ag` for clarity in the open-source context.
- Moved default state file lookup to the project-local `state.json`.
- CHANGELOG reformatted to Keep a Changelog standard.

### Fixed

- Group switching so the card's viewed group no longer changes the CLI's default send target.
- Card snapshot so viewed-group bindings cannot be overwritten by CLI active-group aliases.
- Stopped the card from showing recent Codex threads as if they were saved bindings.

### Removed

- Local state and log files from Git tracking.
