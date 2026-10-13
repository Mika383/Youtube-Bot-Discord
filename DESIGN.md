# Design System

## Experience

The interface is used inside Discord while members are already chatting and listening in a voice channel. It should feel native to Discord, remain compact, and prioritize immediate recognition over decoration.

## Color

Discord controls use the platform's predefined semantic button styles:

- Primary blue: Pause and Resume.
- Secondary gray: Previous, Skip, Queue, and inactive toggles.
- Success green: active Shuffle and Infinite toggles.
- Danger red: Stop.
- Embed blue: active playback.
- Embed gray: idle or disconnected state.

Color is never the sole state indicator. The embed includes explicit Shuffle and Infinite values.

## Typography and Copy

- Use Discord's native typography.
- Use Vietnamese with diacritics for user-facing copy.
- Keep labels short and information-dense.
- Truncate external titles safely rather than letting Discord reject a payload.

## Now Playing Embed

- Title: `Đang phát` while active, `Trình phát` while idle.
- Description: track title, safely truncated.
- Fields: duration, playback state, queue length, requester, Shuffle, Infinite.
- Thumbnail: current track artwork when available.
- Footer: concise control hint or lifecycle state, not decorative copy.

## Controls

First row:

1. `⏮️` Previous, secondary.
2. `⏸️` Pause or `▶️` Resume, primary.
3. `⏭️` Skip, secondary.
4. `⏹️` Stop, danger.

Second row:

1. `📜` Queue, secondary.
2. `🔀` Shuffle, secondary when OFF and success when ON.
3. `🔁` Infinite, secondary when OFF and success when ON.

Buttons use emoji only. Disabled state communicates unavailable actions. Toggle state is repeated in the embed.

## Panel Lifecycle

- State changes edit the authoritative panel in place.
- Successful play actions relocate the panel below their acknowledgement.
- Relocation sends the new panel before deleting the old one.
- If deletion fails, the old panel is edited to remove its active components.
- Periodic progress edits are avoided to reduce Discord API traffic.

## Feedback

- Local interaction failures use ephemeral messages.
- Voice reconnect failure is posted once in the active text channel.
- Permission denial states exactly that the member must join the bot's voice channel.
