# Changelog

All notable changes to `@regentlabs/cli` should be recorded here.

## Unreleased

### Added

- XMTP group management now covers the full operator path from the CLI. Agents and humans can view group members, view current group rules, change group rules, view admins and super admins, add or remove admins and super admins, and remove group members.

### Changed

- XMTP group commands now reject bad inputs before trying the action. Unsupported rule names, unsupported policy names, and metadata values passed to the wrong rule now fail immediately with clearer feedback.
