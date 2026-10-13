# Player Reliability and Now Playing UI Plan

Status: Done (verification not executed)
Approved: 13/10/2026

## Objective

Improve the Discord music player's control surface, state consistency, access rules, voice lifecycle, process recovery, and deployment reliability without changing playlist persistence or Git-tracked user IDs.

## Approved scope

- Redesign the Now Playing panel around icon-only Discord controls.
- Move the active panel to the latest chat position after successful play actions.
- Replace the combined Shuffle & Loop control with independent Shuffle and Infinite toggles.
- Make button and slash-command permissions consistent.
- Fix the Queue button payload.
- Add voice empty-channel handling, reconnect feedback, and graceful process shutdown.
- Bound Discord content and suppress mentions from external metadata.
- Clean expired playlist-panel state and disable music commands in DMs.
- Add a durable yt-dlp refresh command and document PM2 operations.
- Add focused Node test coverage, without running verification unless explicitly requested.
- Update durable project and design documentation.

## Explicit non-goals

- Do not change the `playlists.json` corruption or atomic-write behavior.
- Do not remove Discord user IDs or `playlists.json` from Git.
- Do not add dependencies.
- Do not commit or push.

## Product behavior

- Mutating playback actions require the member to share the bot's voice channel.
- Read-only Queue, Now Playing, and Help actions remain available outside voice.
- Shuffle ON randomizes the remaining queue; turning it OFF does not restore the old order.
- Infinite ON repeats the active playback cycle.
- Shuffle + Infinite reshuffles each repeated cycle.
- If the bot is alone in voice for 60 seconds, it disconnects; the timer is canceled when a listener returns.
- Successful play actions post their acknowledgement first, then relocate the active panel to the latest chat position.

## UI contract

- Primary row: Previous, Pause/Resume, Skip, Stop.
- Secondary row: Queue, Shuffle, Infinite.
- Buttons use emoji only.
- Primary playback control is blue; navigation/read controls are gray; Stop is red.
- Shuffle and Infinite are gray when OFF and green when ON.
- The embed repeats toggle states in text so meaning does not depend on color alone.
- Old panels are deleted where possible and otherwise disabled.

## Phases

1. **Done**: Save product/design context and inspect all affected call sites.
2. **Done**: Normalize playback mode state and permissions.
3. **Done**: Rebuild Now Playing payload and relocation flow.
4. **Done**: Add voice/process lifecycle recovery.
5. **Done**: Harden Discord output and panel state cleanup.
6. **Done**: Add operational scripts, tests, and documentation.
7. **Done**: Review the diff and report unverified items.

## Risks and mitigations

- Concurrent `/play` actions may create duplicate panels: serialize panel writes per guild.
- Existing messages contain the removed custom ID: respond safely and direct users to the current panel.
- Discord exposes only predefined button colors: pair color with embed state text.
- Repeated panel edits can hit rate limits: do not run a periodic progress edit loop.
- Fatal shutdown can hang on external resources: use a bounded graceful-shutdown timeout.

## Definition of Done

- Approved UI and toggle semantics are implemented consistently.
- The current panel is latest after every supported play entry point.
- Stale panels cannot control playback.
- Mutating controls enforce the approved same-channel rule.
- Voice empty-channel and reconnect failure paths provide controlled cleanup and feedback.
- PM2 shutdown and yt-dlp refresh workflows are documented.
- No approved non-goal is modified.
- Documentation matches implementation.
- Any unexecuted verification is reported explicitly.
