# Discord Music Bot (Ringo)

Discord music bot cho YouTube, ho tro queue, now playing panel, playlist theo user, va import playlist YouTube.

## Features

- Phat nhac YouTube theo URL, theo ten tim kiem, hoac playlist.
- Now Playing UI gon, luon duoc dua xuong cuoi chat sau khi `/play`:
  - `⏮️` Previous, `⏸️/▶️` Pause/Resume, `⏭️` Skip, `⏹️` Stop
  - `📜` Queue
  - `🔀` Shuffle va `🔁` Infinite la hai che do doc lap
  - Toggle OFF mau xam, ON mau xanh la; trang thai cung duoc ghi trong embed
- Playlist ca nhan theo tai khoan Discord (user khac khong sua duoc).
- Playlist panel UI (ephemeral) de thao tac nhanh.
- Import playlist YouTube vao playlist local.
- Luu queue hien tai vao playlist local.
- Lenh `/present` de render lai UI khi panel bi loi/mat.
- Lenh `/ringo` de xem huong dan tong hop.

## Stack

- Node.js (CommonJS)
- discord.js v14
- @discordjs/voice
- @distube/ytdl-core
- play-dl
- yt-dlp-exec
- dotenv

## Requirements

- Node.js 22.12+ (bat buoc boi `@discordjs/voice` hien tai)
- Discord bot token + app client id
- Quyen bot trong server:
  - View Channels
  - Send Messages
  - Use Application Commands
  - Connect
  - Speak

## Setup

1. Cai dependencies:

```bash
npm install
```

2. Tao file `.env` tu `.env.example`:

```env
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
DISCORD_GUILD_ID=your_test_server_id_here
```

Ghi chu:
- `DISCORD_GUILD_ID` khuyen nghi cho dev: slash commands update nhanh gan nhu ngay lap tuc.
- Neu bo trong `DISCORD_GUILD_ID`, bot dang ky global commands (co the tre).

3. Chay bot:

```bash
npm start
```

## Command Reference

### Music

- `/play url input:<youtube_url>`
  - Them bai YouTube vao queue.

- `/play search input:<keyword>`
  - Tim bai dau tien tren YouTube theo keyword va them vao queue.

- `/play myplaylist name:<playlist_name> [infinite:true|false]`
  - Play ngay playlist local da luu cua ban.

- `/play playlist url:<youtube_playlist_url> [infinite:true|false]`
  - Nap playlist YouTube URL vao queue va phat.

- `/skip`
  - Skip bai hien tai.

- `/shuffle`
  - Bat hoac tat Shuffle; khi bat se tron phan queue con lai.

- `/stop`
  - Dung phat, clear queue, disconnect voice.

- `/leave`
  - Roi voice channel.

- `/kill`
  - Huy phien phat, xoa queue va roi voice ngay lap tuc.

- `/queue`
  - Hien thi queue duoi dang embed.

- `/present`
  - Dua Now Playing UI xuong vi tri moi nhat trong channel hien tai.

- `/ringo`
  - Hien thi huong dan tong hop tat ca lenh.

Luu y: lenh thay doi phat nhac chi hoat dong khi ban o cung voice channel voi bot.

### Playlist Create (`/createplaylist` va alias `/cpl`)

- `/cpl create name:<name>`
- `/cpl rename name:<old> new_name:<new>`
- `/cpl delete name:<name>`
- `/cpl import name:<local_name> url:<youtube_playlist_url>`

### Playlist Use (`/myplaylist` va alias `/mpl`)

- `/mpl panel`
  - Mo UI panel playlist (ephemeral).

- `/mpl list`
  - Liet ke playlist cua ban.

- `/mpl view name:<name>`
  - Xem preview bai trong playlist.

- `/mpl add name:<name> url:<youtube_url>`
  - Them 1 bai vao playlist.

- `/mpl remove name:<name> index:<n>`
  - Xoa bai theo vi tri.

- `/mpl play name:<name> [infinite:true|false]`
  - Phat playlist local.

- `/mpl savequeue name:<name> [mode:replace|append]`
  - Luu bai dang phat + hang cho hien tai vao playlist local.

## Playlist Panel UI

Trong `/mpl panel`, ban co:

- Select playlist
- Buttons:
  - Play
  - Play Infinite
  - Save Queue
  - Add Current
  - Remove Last
  - Delete Playlist
  - Refresh
- Select menu de xoa bai theo vi tri bat ky

Luu y:
- Panel la ephemeral, gan voi owner.
- User khac khong the thao tac panel cua ban.

## Shuffle va Infinite

- `🔀` bat/tat Shuffle. Khi bat, phan queue con lai duoc tron; khi tat, thu tu cu khong duoc khoi phuc.
- `🔁` bat/tat Infinite de lap lai phien phat.
- Khi ca hai cung bat, moi vong lap duoc tron lai.
- Cac thao tac thay doi phat nhac chi danh cho thanh vien dang o cung voice channel voi bot.

## Data Storage

- File `playlists.json` duoc tao o root project.
- Du lieu chia theo `userId` Discord.
- Gioi han hien tai:
  - Toi da 20 playlist / user
  - Toi da 200 bai / playlist

## Project Structure

```text
src/
  commands/
    registerCommands.js
  handlers/
    interactionHandler.js
  services/
    nowPlayingPanel.js
    playerService.js
    playlistPanelService.js
    youtubeService.js
  utils/
    format.js
  playlistStore.js
  index.js
```

## Troubleshooting

### 1) Slash command moi khong hien

- Dam bao `.env` co `DISCORD_GUILD_ID` dung server test.
- Restart bot.
- Reload Discord client (`Ctrl+R`).

### 2) Playlist YouTube khong parse duoc

- Thu playlist URL public.
- Neu private/age-restricted/region-locked co the fail.
- Thu lai voi playlist khac de phan biet loi data.

### 3) Loi audio provider

- Bot thu theo thu tu `yt-dlp` -> `play-dl` -> `ytdl-core`.
- Neu tat ca provider deu loi, bot tra thong bao playback that bai thay vi bao da them bai thanh cong.

### 4) Nhac vao `Playing` roi dung ngay

- Chay `npm run update:yt-dlp` de tai lai executable `yt-dlp` stable.
- Pipeline hien uu tien WebM/Opus truc tiep de tranh encode lai, sau do fallback qua `play-dl` va `ytdl-core`.
- Bot chi danh dau provider san sang sau khi nhan duoc audio data dau tien; exit code va stderr cua `yt-dlp` duoc ghi log co gioi han.

### 5) Panel bi mat hoac loi UI

- Dung `/present` de render lai panel.

## Linux/PM2 Deploy Shortcut

Chay mot lan tren server de tao lenh `deploybot` trong `~/.bashrc`:

```bash
echo 'deploybot() { (cd /home/duyhai/discord-bot && git pull --ff-only origin main && npm install && npm run update:yt-dlp && pm2 restart ahso && pm2 status ahso); }' >> ~/.bashrc
source ~/.bashrc
```

Sau do deploy bang:

```bash
deploybot
```

Luu y: dong `echo ... >> ~/.bashrc` se append them dinh nghia moi moi lan chay. Chi chay mot lan, hoac xoa dinh nghia cu truoc khi them lai.

De gioi han dung luong log PM2 tren server, cai module rotation mot lan:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

Bot xu ly `SIGINT`/`SIGTERM`, dong voice va audio stream truoc khi PM2 restart.

## Security Notes

- Khong commit `.env`.
- Neu token lo ra ngoai, rotate ngay trong Discord Developer Portal.
- `.env.example` chi de placeholder, khong de token that.

## Dev Tips

- Sau khi doi command schema, luon restart bot.
- Khi test command moi, uu tien guild commands (co `DISCORD_GUILD_ID`).
- Bo test tap trung dung Node.js built-in runner: `npm test`.
- Neu thay warning `ephemeral` deprecated, co the refactor sang `flags` o buoc tiep theo.
