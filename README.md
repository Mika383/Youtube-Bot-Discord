# Discord Music Bot (Ringo)

Discord music bot cho YouTube, ho tro queue, now playing panel, playlist theo user, va import playlist YouTube.

## Features

- Phat nhac YouTube bang mot lenh `/play`, tu dong nhan dien ten bai, URL video hoac URL playlist.
- Now Playing UI gon voi cac nut dieu khien:
  - `⏮️` Previous, `⏸️/▶️` Pause/Resume, `⏭️` Skip, `⏹️` Stop
  - `📜` Queue
  - `🔀` Shuffle va `🔁` Infinite la hai che do doc lap
  - Toggle OFF mau xam, ON mau xanh la; trang thai cung duoc ghi trong embed
- Sau moi phan hoi interaction cua bot, neu guild dang co player/panel, Now Playing duoc gui lai o cuoi chat va panel cu dang duoc theo doi se bi xoa.
- Phan hoi ephemeral cung kich hoat viec di chuyen panel cong khai. Khi bai tu chuyen ma khong co phan hoi, bot chi cap nhat panel moi nhat.
- Playlist ca nhan theo tai khoan Discord (user khac khong sua duoc).
- Mot lenh `/playlist` mo panel ephemeral de quan ly toan bo playlist ca nhan.
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
LOG_LEVEL=info
YOUTUBE_COOKIES_FILE=
```

Ghi chu:
- `DISCORD_GUILD_ID` khuyen nghi cho dev: slash commands update nhanh gan nhu ngay lap tuc.
- Neu bo trong `DISCORD_GUILD_ID`, bot dang ky global commands (co the tre).
- `YOUTUBE_COOKIES_FILE` la tuy chon. Khi khai bao, gia tri phai la duong dan tuyet doi den file cookie Netscape doc duoc boi user chay bot.
- Khong dat file cookie trong repository. Tren Linux, nen dat quyen file la `600` va quyen thu muc la `700`.

3. Chay bot:

```bash
npm start
```

## Command Reference

### Music

- `/play input:<ten_bai_hoac_youtube_url> [infinite:true|false]`
  - Text thuong: tim bai dau tien tren YouTube va them vao queue.
  - URL video: them mot bai vao queue.
  - URL co `list` khong bat dau bang `RD`: nap playlist YouTube vao queue.
  - YouTube Mix/Radio co `list=RD...`: chi phat video goc, khong nap danh sach tu sinh.
  - `infinite` chi hop le khi input duoc nhan dien la playlist YouTube.
  - Playlist local da luu duoc phat tu panel `/playlist`.

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

### Playlist ca nhan

- `/playlist`
  - Mo panel quan ly playlist rieng tu (ephemeral).
  - Khong can nho subcommand hoac alias.

## Playlist Panel UI

Trong `/playlist`, ban co:

- Chon playlist va xem danh sach bai theo tung trang.
- Tao moi, doi ten va xoa playlist.
- Import playlist YouTube hoac them mot video bang URL.
- Phat playlist thuong hoac lap vo han.
- Them bai dang phat vao playlist.
- Xoa bai bang select menu; ho tro toan bo playlist qua nut chuyen trang.
- Luu bai dang phat + hang cho theo che do Ghi de hoac Noi them sau buoc xac nhan.

Luu y:
- Panel la ephemeral, gan voi owner.
- User khac khong the thao tac panel cua ban.
- Panel het han se yeu cau mo lai bang `/playlist`, khong tu chon playlist khac.

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

### 5) YouTube tra ve HTTP 429 hoac yeu cau dang nhap

- Tao file cookie Netscape ben ngoai repository, vi du `/home/duyhai/.config/ahso/youtube-cookies.txt`.
- Them vao `.env`: `YOUTUBE_COOKIES_FILE=/home/duyhai/.config/ahso/youtube-cookies.txt`.
- Restart bang `pm2 restart ahso --update-env`.
- Khi phat hien HTTP 429 hoac `LOGIN_REQUIRED`, bot tam dung cac yeu cau YouTube moi trong 5 phut de tranh retry lien tuc.
- Cookie chi duoc truyen cho `yt-dlp`; bot khong ghi noi dung hoac duong dan cookie vao log.

### 6) Panel bi mat hoac loi UI

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
- Khong commit, chia se hoac in noi dung file cookie YouTube ra log.
- Nen dung tai khoan Google rieng, khong co du lieu quan trong, va thu hoi phien dang nhap neu nghi ngo cookie bi lo.
- Neu token lo ra ngoai, rotate ngay trong Discord Developer Portal.
- `.env.example` chi de placeholder, khong de token that.

## Dev Tips

- Sau khi doi command schema, luon restart bot.
- Khi test command moi, uu tien guild commands (co `DISCORD_GUILD_ID`).
- Bo test tap trung dung Node.js built-in runner: `npm test`.
- Neu thay warning `ephemeral` deprecated, co the refactor sang `flags` o buoc tiep theo.
