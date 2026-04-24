# Changelog

## 2026-04-24

- Added a Chinese open-source README with architecture diagram and CLI reference.
- Added MIT license.
- Removed local state and log files from Git tracking.
- Added a local state example file.
- Fixed group switching so the card's viewed group no longer changes the CLI's default send target.
- Added `--group` support for targeting a specific group from the CLI.
- Added a macOS LaunchAgent installer for the card service.
- Moved the default state file lookup to the project-local `state.json`.
