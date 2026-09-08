# AWUN product roadmap

[Project overview](README.md) · [Русская версия](ROADMAP.ru.md) · [Case study](docs/PROJECT_CASE_STUDY.md)

This roadmap uses exit criteria instead of unsupported dates. Completed engineering work is separated from product validation that has not happened yet.

## Shipped foundation

- Public web beta and a versioned Windows installer and portable executable.
- Local-first desktop backend with provider-level remote fallback.
- Progressive multi-source search, persistent queue and playback recovery.
- On-device library, My Wave signals, backup and validated restore.
- 233 Python tests and 26 Playwright scenarios in required CI workflows.

## Now: validate the product with people

Goal: replace assumptions about usability with traceable observations.

- Run the same five-task script with at least three consenting participants.
- Record completion, time, blocking errors and requested clarification for each task.
- Open one GitHub issue per reproducible problem and link the fixing commit.
- Publish only aggregated results; do not expose personal searches or identity data.

Exit criterion: every blocking finding is either fixed and verified or documented as an explicit limitation.

## Next: make Windows distribution trustworthy

- Add Authenticode signing so official builds have a verifiable publisher.
- Document an update and rollback path for installed versions.
- Add release smoke checks on a clean Windows environment.
- Track public service uptime and provider-specific latency without collecting a personal listening history.

Exit criterion: a clean Windows machine can verify, install, run, update and remove AWUN through a documented path.

## Then: validate mobile distribution

- Complete a closed Android test with Play signing and store disclosure review.
- Verify the Play client never exposes disallowed download controls.
- Test lifecycle, media controls and local-data recovery on physical devices.
- Keep iOS distribution experimental until Apple signing and physical-device testing are available.

Exit criterion: the Android package passes closed testing and every data-safety statement matches observed network and storage behavior.

## Later, only if evidence supports it

- Optional cross-device synchronization.
- Public social features.
- Broader provider integrations.

These features require accounts, privacy controls, moderation or new provider agreements. They are not commitments and will not be simulated before those prerequisites exist.
