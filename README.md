# Discord Music Bot (Ringo)

Discord music bot cho YouTube, ho tro queue, now playing panel, playlist theo user, va import playlist YouTube.

## Features

- Phat nhac YouTube theo URL, theo ten tim kiem, hoac playlist.
- Now Playing UI trong chat voi buttons:
  - Pause/Resume
  - Previous
  - Skip
  - Infinite ON/OFF
  - Stop
  - Queue
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
- yt-dlp-exec
- dotenv

## Requirements

- Node.js 18+ (khuyen nghi 20+)
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

- `/stop`
  - Dung phat, clear queue, disconnect voice.

- `/leave`
  - Roi voice channel.

- `/queue`
  - Hien thi queue duoi dang embed.

- `/present`
  - Ve lai Now Playing UI trong channel hien tai (useful khi panel bi mat/loi).

- `/ringo`
  - Hien thi huong dan tong hop tat ca lenh.

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

## Infinite Modes

Bot co 2 co che infinite:

1. Queue infinite (button `Infinite ON/OFF` trong Now Playing)
- Lap lai toan bo queue snapshot hien tai.

2. Playlist infinite (khi dung `/play myplaylist ... infinite:true`, `/play playlist ... infinite:true`, hoac `Play Infinite` trong panel playlist)
- Lap lai danh sach bai cua playlist do.

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

### 3) ytdl-core warning `Failed to find any playable formats`

- Bot se fallback sang `yt-dlp`.
- Day la warning pho bien, khong phai luc nao cung la loi gay dung bot.

### 4) Panel bi mat hoac loi UI

- Dung `/present` de render lai panel.

## Security Notes

- Khong commit `.env`.
- Neu token lo ra ngoai, rotate ngay trong Discord Developer Portal.
- `.env.example` chi de placeholder, khong de token that.

## Dev Tips

- Sau khi doi command schema, luon restart bot.
- Khi test command moi, uu tien guild commands (co `DISCORD_GUILD_ID`).
- Neu thay warning `ephemeral` deprecated, co the refactor sang `flags` o buoc tiep theo.
