# Ringo Discord control emojis

Bộ emoji điều khiển riêng cho màn hình Now Playing của Ringo.

## Thư mục

- `upload/`: PNG 128 x 128, nền trong suốt, sẵn sàng để upload lên Discord.
- `source/`: ảnh gốc độ phân giải cao để chỉnh sửa hoặc xuất lại.
- `preview.png`: ảnh xem nhanh theo thứ tự bên dưới.

## Tên emoji đề xuất

| File | Tên trên Discord | Chức năng |
| --- | --- | --- |
| `ringo_previous.png` | `ringo_previous` | Bài trước |
| `ringo_pause.png` | `ringo_pause` | Tạm dừng |
| `ringo_play.png` | `ringo_play` | Phát tiếp |
| `ringo_next.png` | `ringo_next` | Bài tiếp theo |
| `ringo_stop.png` | `ringo_stop` | Dừng phát |
| `ringo_queue.png` | `ringo_queue` | Hàng chờ |
| `ringo_shuffle.png` | `ringo_shuffle` | Phát ngẫu nhiên |
| `ringo_infinite.png` | `ringo_infinite` | Lặp vô hạn |
| `ringo_now_playing.png` | `ringo_now_playing` | Tiêu đề trình phát |
| `ringo_duration.png` | `ringo_duration` | Thời lượng |
| `ringo_requester.png` | `ringo_requester` | Người yêu cầu |

Các ID custom emoji của server HOMIES đang được gắn trực tiếp trong `src/services/nowPlayingPanel.js`. Nếu chuyển bot sang server khác hoặc tạo lại emoji, cần cập nhật mapping này.
