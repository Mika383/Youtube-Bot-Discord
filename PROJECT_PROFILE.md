# PROJECT PROFILE

Cap nhat lan cuoi: 14/10/2026

## Project

- Ten package: `discord-music-bot`; ten hien thi trong README: Ringo.
- Muc dich: bot nhac Discord phat noi dung YouTube, quan ly queue theo server va playlist ca nhan theo tai khoan Discord.
- Loai ung dung: mot tien trinh Node.js chay lau dai, ket noi Discord Gateway va Discord Voice.
- Trang thai hien tai: MVP nho, mot package, khong co frontend web, backend HTTP, database server hay Electron.

## Stack

- JavaScript CommonJS, chua dung TypeScript.
- Node.js; runtime hieu luc phai la `>=22.12.0` do `@discordjs/voice@0.19.2` yeu cau.
- npm voi `package-lock.json` lockfile version 3.
- Discord: `discord.js@14.26.2`, `@discordjs/voice@0.19.2`.
- YouTube/audio: `play-dl@1.9.7`, `yt-dlp-exec@1.0.2`, `@distube/ytdl-core@4.16.12`.
- Cau hinh moi truong: `dotenv@17.4.2`.
- `yt-dlp-exec` cung cap executable `yt-dlp`; script `npm run update:yt-dlp` rebuild package roi doi chieu version voi GitHub Releases.
- FFmpeg la dependency runtime ben ngoai cho cac audio path can demux/transcode; phai co san tren may deploy.
- Test dung `node:test` co san trong Node.js; khong co linter, formatter, build step hoac CI trong repository.

`package.json` va README khai bao Node.js `>=22.12.0`, dong bo voi engine requirement cua `@discordjs/voice@0.19.2`.

## Architecture

Luồng chinh:

```text
Discord interaction
  -> interactionHandler
     -> playerService -> youtubeService -> Discord Voice
     -> playlistStore -> playlists.json
     -> nowPlayingPanel / playlistPanelService -> Discord messages, embeds, components
  -> structured console logger
```

Ranh gioi module:

- `src/index.js`: nap env, tao Discord client, wire cac service, dang ky slash command va bat dau bot.
- `src/commands/registerCommands.js`: dinh nghia 13 slash command, gom cac alias `cpl` va `mpl`.
- `src/handlers/interactionHandler.js`: dieu phoi toan bo slash command, button, select menu va phan hoi loi.
- `src/services/playerService.js`: state player theo guild, voice connection, queue, history, loop, shuffle va idle disconnect.
- `src/services/youtubeService.js`: chuan hoa URL, metadata, search, playlist extraction va audio stream fallback.
- `src/services/nowPlayingPanel.js`: embed va control cua Now Playing.
- `src/services/playlistPanelService.js`: UI ephemeral de quan ly playlist va state panel trong RAM.
- `src/playlistStore.js`: persistence JSON dong bo.
- `src/utils/logger.js`: structured console logging.
- `src/utils/format.js`: format duration va cat ngan label.

Khong co DI framework. Dependency duoc tao va truyen thu cong tu `src/index.js`.

## Runtime State

- `playerService.queue` la `Map<guildId, guildState>` trong RAM.
- Moi guild co mot audio player, voice connection, queue, current track, history toi da 100 bai, loop templates va Discord panel IDs.
- Queue, current track, panel state va voice state mat khi process restart.
- Audio uu tien WebM/Opus passthrough voi buffer gioi han 256 KiB; khong tai toan bo bai vao RAM.
- Bot chi tao resource sau khi provider co byte audio dau tien. Child process `yt-dlp` co timeout khoi tao, stderr gioi han va cleanup khi stream dung.
- Queue rong se bat timer 30 giay roi disconnect. Neu voice khong con listener, bot doi 60 giay roi dung phien va roi kenh; timer bi huy khi listener quay lai.
- `globalThis.__musicQueue` expose Map noi bo de debug trong cung process.

## Commands and UI

Command goc:

- Music: `/play`, `/skip`, `/stop`, `/queue`, `/shuffle`, `/leave`, `/kill`, `/present`, `/ringo`.
- Playlist creation: `/createplaylist` va alias `/cpl`.
- Playlist use: `/myplaylist` va alias `/mpl`.

`/play input:<text-or-url> [infinite]` tu dong phan loai: text thanh search, URL video thanh mot track, `list` khong bat dau bang `RD` thanh playlist, va Mix/Radio `RD...` thanh video goc. Playlist local phat qua `/myplaylist play` hoac `/mpl play`. Audio stream thu lan luot `yt-dlp -> play-dl -> ytdl-core`; metadata thu `yt-dlp -> ytdl-core`; playlist thu `yt-dlp -> play-dl`, sau do co fallback ve seed video cho YouTube Mix/Radio. Voice negotiation va YouTube resolution cua `/play` chay song song de giam thoi gian bat dau.

UI chi nam trong Discord:

- Now Playing embed voi icon-only controls; Shuffle va Infinite la hai toggle doc lap, mau xam khi OFF va xanh la khi ON.
- 11 custom emoji dang dung ID cua mot Discord server cu the. Asset goc va ban upload 128x128 nam trong `assets/discord-emojis/`; khi bot chuyen server hoac emoji bi tao lai, mapping ID phai duoc cap nhat.
- Sau moi interaction response, neu guild dang co player hoac panel, Now Playing duoc gui lai xuong cuoi chat; panel cu dang duoc theo doi bi xoa hoac vo hieu hoa. Phan hoi ephemeral van kich hoat relocation cong khai; chuyen bai tu dong khong co response chi update panel moi nhat.
- Queue embed co pagination 10 bai/trang.
- Playlist panel ephemeral theo owner, select playlist va cac nut thao tac.
- Track removal select chi hien 25 bai dau trong playlist; slash command van co the xoa cac vi tri lon hon.

## Data Storage

- Khong co PostgreSQL, ORM hay migrations.
- File du lieu: `playlists.json`, duong dan duoc tinh tu `process.cwd()`.
- File hien dang duoc Git track.
- Snapshot discovery: 1 user, 1 playlist, 4 tracks; JSON hop le, khong co track thieu URL/title, khong vuot limit va khong co URL trung trong cung playlist.
- Gioi han ung dung: 20 playlist/user, 200 tracks/playlist, ten playlist toi da 24 ky tu.

Schema logic:

```text
users[userId]
  playlists[normalizedLowercaseKey]
    key
    name
    createdAt (Unix milliseconds)
    tracks[]
      url
      title
      durationSec
      thumbnail
      addedAt (Unix milliseconds)
```

Tat ca mutation ghi lai toan bo JSON bang `writeFileSync`; khong co atomic rename, lock, backup, schema version hay recovery.

## Authentication and Authorization

- Danh tinh den tu Discord interaction; bot khong co login/session rieng.
- Playlist tach theo `interaction.user.id`.
- Playlist component custom ID chua owner ID va handler kiem tra dung owner truoc khi mutation.
- Khong co role/permission model hay gioi han command bang Discord permission.
- Moi button va slash command thay doi phat nhac deu yeu cau nguoi dung dang o cung voice channel voi bot.
- Queue, Now Playing va Help la read-only, khong yeu cau vao voice.
- Music command duoc tat trong DM.

## Configuration

Bien bat buoc:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`

Bien tuy chon:

- `DISCORD_GUILD_ID`: neu co thi dang ky command theo guild, neu khong thi dang ky global.
- `LOG_LEVEL`: ho tro `debug`, `info`, `warn`, `error`; mac dinh va `.env.example` dung `info`.
- `YOUTUBE_COOKIES_FILE`: duong dan tuyet doi tuy chon den file cookie Netscape nam ngoai repository. Neu duoc khai bao, bot yeu cau file ton tai, khong rong, doc duoc va dung header Netscape ngay khi khoi dong.

`.env` dang duoc `.gitignore`. `.env.example` khai bao nam bien; file `.env` cuc bo tai thoi diem discovery co ba bien Discord va khong co `LOG_LEVEL` hoac `YOUTUBE_COOKIES_FILE`.

## Logging and Error Handling

- Log ra stdout/stderr theo dang: ISO UTC timestamp, level, scope, message va JSON metadata.
- Scope hien co: `app`, `interaction`, `player`, `youtube`.
- Error duoc serialize kem stack/stdout/stderr co gioi han do dai.
- Loi provider YouTube duoc rut gon va che duong dan cookie truoc khi ghi log.
- Khong co redaction theo ten field, correlation ID, file rotation, retention hay log category file.
- Default log level la `info`; gia tri `LOG_LEVEL` khong hop le hien fallback ve `debug`.
- `SIGINT`, `SIGTERM`, `unhandledRejection` va `uncaughtException` deu di qua graceful shutdown co timeout; fatal error thoat ma khac 0 de PM2 restart.

## Deployment and Operations

- Lenh chay: `npm start` hoac `npm run dev`; hai script hien giong nhau (`node src/index.js`).
- Deployment muc tieu dung PM2; README co shortcut pull/install/refresh yt-dlp/restart va huong dan `pm2-logrotate`.
- `npm run update:yt-dlp` rebuild package de chay lai lifecycle tai executable stable.
- Can Internet den Discord va YouTube.
- Can bot permission: View Channels, Send Messages, Use Application Commands, Connect va Speak.
- Slash command duoc REST `PUT` lai moi lan client ready; body hien tai quan ly toan bo command set trong guild/application scope do.
- Khong co release tag trong Git tai thoi diem discovery.

## Git

- Remote: `origin` tro den repository GitHub `Mika383/Youtube-Bot-Discord`.
- `main` tai `0f6543f`; `3nd` tai `3f7aaca`. Hai nhanh co cung tree tai thoi diem discovery 14/10/2026.
- Lich su bat dau tu MVP ngay 14/04/2026; thay doi gan nhat them bo custom emoji va cap nhat Now Playing UI ngay 13/10/2026.
- Khong co release tag.
- `node_modules/` nam trong `.gitignore` nhung 3.111 file ben trong da duoc commit tu truoc; cai dat/cap nhat dependency co the tao hang nghin Git diff khong mong muon.

## Stable Behavior to Preserve

- Playlist duoc so huu rieng theo Discord user ID.
- URL video chi chap nhan cac host YouTube duoc allowlist.
- Queue/player tach theo guild.
- Playlist local toi da 20/user va 200 bai/playlist.
- Nut player yeu cau cung voice channel voi bot.
- YouTube provider fallback va Mix/Radio seed fallback.
- Cookie YouTube, neu cau hinh, chi duoc truyen vao bon luong `yt-dlp`: stream, metadata, search va playlist. Khi gap HTTP 429 hoac yeu cau xac minh, circuit breaker dung request YouTube moi trong 5 phut thay vi tiep tuc fallback/retry.
- Auto-disconnect 30 giay sau khi queue ket thuc.
- Guild command registration khi co `DISCORD_GUILD_ID`, global registration khi khong co.

## Known Risks and Technical Debt

### Accepted for now

- `playlistStore.loadStore()` bat moi loi doc/parse va am tham tra store rong; lan ghi tiep theo co the ghi de du lieu hu.
- `playlists.json` chua Discord user ID va lich su bai hat nhung van duoc Git track.
- Persistence van synchronous, khong atomic, khong backup va phu thuoc current working directory.

### Remaining

- Queue, current track va panel state van nam trong RAM va mat khi process restart.
- Refresh `yt-dlp` can Internet va phu thuoc GitHub release endpoint cua package.
- Log rotation phu thuoc cau hinh `pm2-logrotate` tren server, khong duoc app tu quan ly.
- Logging chua co correlation ID hoac redaction theo ten field tong quat.
- Bo test hien chi co 2 file/4 test case, tap trung vao Now Playing controls va hai che do Shuffle/Infinite.
- Track-removal select trong playlist panel chi hien 25 bai dau; slash command van xoa duoc vi tri lon hon.
- Selected playlist cua panel chi nam trong RAM voi TTL 30 phut. Sau khi state het han hoac process restart, action tren panel cu fallback ve playlist dau tien; cac action mutation khong confirm co nguy co tac dong nham playlist.
- `Save Queue` tren panel va `/myplaylist savequeue` ghi/de toan bo playlist ngay, chua co buoc xac nhan manual save.
- `/stop`, `/leave` va `/kill` van dung chung clear/disconnect core, chi khac y nghia va message nguoi dung.
- External metadata/search/playlist calls chua co timeout tong the; playlist lon co the duoc nap het vao RAM truoc khi cat con 200 bai de luu.
- Guild player state khong duoc xoa khoi `Map` sau disconnect; bot tham gia rat nhieu guild theo thoi gian co the giu state rong lau dai.
- Khong co command cooldown/rate limit rieng cho cac thao tac YouTube ton tai nguyen.

## Constraints for Future Changes

- Khong duoc xem `playlists.json` la database an toan neu chua bo sung atomic write, backup va corruption handling.
- Ownership playlist giu theo Discord user ID; music-control mutation chi cho nguoi o cung voice channel.
- Chuoi provider `yt-dlp -> play-dl -> ytdl-core` va WebM/Opus passthrough la stable behavior; thay doi tiep can kiem tra tren moi truong deploy thuc te.
- Neu nang cap dependency, phai doi chieu Node engine, FFmpeg va kha nang YouTube provider.
- Khong log Discord token, signed media URL hoac secret. Logger hien chua redact theo key, nen metadata moi phai duoc review truoc khi log.
- Queue/state hien khong ben vung qua restart; tinh nang can persistence phai duoc thiet ke ro, khong suy dien tu playlist store hien tai.
