# Discord Music Bot MVP

Project folder riêng cho bot phát nhạc Discord.

## Tính năng MVP
- `/play <youtube_url>`
- `/skip`
- `/stop`
- `/queue`
- `/leave`

## Chuẩn bị
1. Copy `.env.example` thành `.env`
2. Điền:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
3. Cài dependencies:
   - `npm install`
4. Chạy bot:
   - `npm start`

## Ghi chú
- Bản đầu ưu tiên YouTube URL trực tiếp.
- Search, playlist, reconnect tốt hơn, và quản lý queue nâng cao có thể thêm sau.
- Bot cần quyền voice: Connect, Speak, View Channels, Send Messages, Use Application Commands.
