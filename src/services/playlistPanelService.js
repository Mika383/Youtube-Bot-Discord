const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { formatDuration, truncateLabel, truncateText } = require('../utils/format');

const PL_SELECT = 'pl_select';
const PL_PLAY = 'pl_play';
const PL_PLAY_INFINITE = 'pl_play_infinite';
const PL_ADD_CURRENT = 'pl_add_current';
const PL_SAVE_QUEUE = 'pl_save_queue';
const PL_CREATE = 'pl_create';
const PL_RENAME = 'pl_rename';
const PL_IMPORT = 'pl_import';
const PL_ADD_URL = 'pl_add_url';
const PL_DELETE = 'pl_delete';
const PL_DELETE_CONFIRM = 'pl_delete_confirm';
const PL_DELETE_CANCEL = 'pl_delete_cancel';
const PL_SAVE_REPLACE = 'pl_save_replace';
const PL_SAVE_APPEND = 'pl_save_append';
const PL_SAVE_CANCEL = 'pl_save_cancel';
const PL_TRACK_REMOVE_SELECT = 'pl_track_remove_select';
const PL_TRACK_PREV = 'pl_track_prev';
const PL_TRACK_NEXT = 'pl_track_next';
const PL_MODAL_CREATE = 'pl_modal_create';
const PL_MODAL_RENAME = 'pl_modal_rename';
const PL_MODAL_IMPORT = 'pl_modal_import';
const PL_MODAL_ADD_URL = 'pl_modal_add_url';
const PL_INPUT_NAME = 'pl_input_name';
const PL_INPUT_URL = 'pl_input_url';
const PANEL_STATE_TTL_MS = 30 * 60 * 1000;
const TRACK_PAGE_SIZE = 10;

function createPlaylistPanelService(playlistStore) {
  const panelState = new Map();

  function buildPlaylistPanelPayload(userId, selectedKey, guildState, note = null, requestedTrackPage = 0) {
    const playlists = playlistStore.listUserPlaylists(userId);
    const hasAny = playlists.length > 0;
    const selected = hasAny
      ? (selectedKey ? playlists.find((playlist) => playlist.key === selectedKey) || null : playlists[0])
      : null;
    const totalTrackPages = selected ? Math.max(1, Math.ceil(selected.tracks.length / TRACK_PAGE_SIZE)) : 1;
    const trackPage = Math.max(0, Math.min(Number(requestedTrackPage) || 0, totalTrackPages - 1));
    const trackStart = trackPage * TRACK_PAGE_SIZE;
    const visibleTracks = selected ? selected.tracks.slice(trackStart, trackStart + TRACK_PAGE_SIZE) : [];

    const embed = new EmbedBuilder()
      .setColor(0x198754)
      .setTitle('Playlist cá nhân')
      .setTimestamp(new Date());

    if (!selected && !hasAny) {
      embed.setDescription('Bạn chưa có playlist nào. Chọn **Tạo mới** hoặc **Nhập YouTube** để bắt đầu.');
    } else if (!selected) {
      embed.setDescription('Playlist đã chọn không còn tồn tại. Hãy chọn lại một playlist.');
    } else {
      const preview = visibleTracks.length === 0
        ? 'Playlist đang trống.'
        : visibleTracks
          .map((track, index) => `${trackStart + index + 1}. ${truncateText(track.title, 80)}${track.durationSec ? ` (${formatDuration(track.durationSec)})` : ''}`)
          .join('\n');

      embed
        .setDescription(`**${selected.name}**`)
        .addFields(
          { name: 'Tổng số bài', value: String(selected.tracks.length), inline: true },
          { name: 'Đang phát', value: guildState.current ? truncateText(guildState.current.title, 200) : 'Không có', inline: true },
          {
            name: selected.tracks.length > TRACK_PAGE_SIZE
              ? `Danh sách bài • Trang ${trackPage + 1}/${totalTrackPages}`
              : 'Danh sách bài',
            value: truncateText(preview, 1024),
          },
        );
    }

    if (note) embed.setFooter({ text: truncateText(note, 500) });

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PL_SELECT}:${userId}`)
        .setPlaceholder('Chọn playlist để thao tác')
        .setDisabled(!hasAny)
        .addOptions(
          hasAny
            ? playlists.map((playlist) => ({
              label: truncateLabel(playlist.name, 80),
              value: playlist.key,
              description: `${playlist.tracks.length} bài`,
              default: selected ? playlist.key === selected.key : false,
            }))
            : [{ label: 'Chưa có playlist', value: 'none', description: 'Hãy tạo playlist đầu tiên' }],
        ),
    );

    const playbackRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PL_PLAY}:${userId}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('Phát')
        .setDisabled(!selected || selected.tracks.length === 0),
      new ButtonBuilder()
        .setCustomId(`${PL_PLAY_INFINITE}:${userId}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('Phát lặp vô hạn')
        .setDisabled(!selected || selected.tracks.length === 0),
      new ButtonBuilder()
        .setCustomId(`${PL_ADD_CURRENT}:${userId}`)
        .setStyle(ButtonStyle.Success)
        .setLabel('Thêm bài đang phát')
        .setDisabled(!selected || !guildState.current),
      new ButtonBuilder()
        .setCustomId(`${PL_SAVE_QUEUE}:${userId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Lưu hàng chờ')
        .setDisabled(!selected),
    );

    const managementRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PL_CREATE}:${userId}`)
        .setStyle(ButtonStyle.Success)
        .setLabel('Tạo mới'),
      new ButtonBuilder()
        .setCustomId(`${PL_RENAME}:${userId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Đổi tên')
        .setDisabled(!selected),
      new ButtonBuilder()
        .setCustomId(`${PL_IMPORT}:${userId}`)
        .setStyle(ButtonStyle.Success)
        .setLabel('Nhập YouTube'),
      new ButtonBuilder()
        .setCustomId(`${PL_ADD_URL}:${userId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Thêm URL')
        .setDisabled(!selected),
      new ButtonBuilder()
        .setCustomId(`${PL_DELETE}:${userId}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Xóa playlist')
        .setDisabled(!selected),
    );

    const components = [selectRow, playbackRow, managementRow];

    if (selected && visibleTracks.length > 0) {
      components.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PL_TRACK_REMOVE_SELECT}:${userId}`)
          .setPlaceholder('Chọn bài cần xóa khỏi playlist')
          .addOptions(visibleTracks.map((track, index) => ({
            label: truncateLabel(`${trackStart + index + 1}. ${track.title}`, 100),
            value: String(trackStart + index + 1),
            description: track.durationSec ? formatDuration(track.durationSec) : 'Chưa rõ thời lượng',
          }))),
      ));
    }

    if (selected && totalTrackPages > 1) {
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PL_TRACK_PREV}:${userId}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Trang trước')
          .setDisabled(trackPage <= 0),
        new ButtonBuilder()
          .setCustomId(`${PL_TRACK_NEXT}:${userId}`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel('Trang sau')
          .setDisabled(trackPage >= totalTrackPages - 1),
      ));
    }

    return {
      selectedKey: selected?.key || null,
      trackPage,
      payload: { embeds: [embed], components },
    };
  }

  function buildDeleteConfirmationPayload(userId, selectedKey) {
    const playlist = playlistStore.getPlaylistByKey(userId, selectedKey);
    if (!playlist) throw new Error('Không tìm thấy playlist cần xóa.');

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🗑️ Xác nhận xóa playlist')
      .setDescription(`Bạn có chắc muốn xóa **${playlist.name}** và ${playlist.tracks.length} bài bên trong không?`);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PL_DELETE_CONFIRM}:${userId}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Xóa'),
      new ButtonBuilder()
        .setCustomId(`${PL_DELETE_CANCEL}:${userId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Hủy'),
    );

    return { embeds: [embed], components: [row] };
  }

  function buildSaveQueueConfirmationPayload(userId, selectedKey, queueTrackCount) {
    const playlist = playlistStore.getPlaylistByKey(userId, selectedKey);
    if (!playlist) throw new Error('Không tìm thấy playlist cần lưu.');

    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle('💾 Xác nhận lưu hàng chờ')
      .setDescription([
        `Hàng chờ hiện có **${queueTrackCount} bài**.`,
        `Playlist **${playlist.name}** hiện có **${playlist.tracks.length} bài**.`,
        '',
        '**Ghi đè** sẽ thay toàn bộ nội dung playlist.',
        '**Nối thêm** sẽ giữ các bài cũ và thêm hàng chờ vào cuối.',
      ].join('\n'));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PL_SAVE_REPLACE}:${userId}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Ghi đè'),
      new ButtonBuilder()
        .setCustomId(`${PL_SAVE_APPEND}:${userId}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('Nối thêm'),
      new ButtonBuilder()
        .setCustomId(`${PL_SAVE_CANCEL}:${userId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Hủy'),
    );

    return { embeds: [embed], components: [row] };
  }

  function buildCreateModal(userId) {
    return new ModalBuilder()
      .setCustomId(`${PL_MODAL_CREATE}:${userId}`)
      .setTitle('Tạo playlist mới')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(PL_INPUT_NAME)
          .setLabel('Tên playlist')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(24)
          .setRequired(true),
      ));
  }

  function buildRenameModal(userId, selectedKey) {
    const playlist = playlistStore.getPlaylistByKey(userId, selectedKey);
    if (!playlist) throw new Error('Không tìm thấy playlist cần đổi tên.');

    return new ModalBuilder()
      .setCustomId(`${PL_MODAL_RENAME}:${userId}:${selectedKey}`)
      .setTitle('Đổi tên playlist')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(PL_INPUT_NAME)
          .setLabel('Tên mới')
          .setStyle(TextInputStyle.Short)
          .setValue(playlist.name)
          .setMaxLength(24)
          .setRequired(true),
      ));
  }

  function buildImportModal(userId) {
    return new ModalBuilder()
      .setCustomId(`${PL_MODAL_IMPORT}:${userId}`)
      .setTitle('Nhập playlist YouTube')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(PL_INPUT_NAME)
            .setLabel('Tên playlist cá nhân')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(24)
            .setRequired(true),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(PL_INPUT_URL)
            .setLabel('URL playlist YouTube')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      );
  }

  function buildAddUrlModal(userId, selectedKey) {
    const playlist = playlistStore.getPlaylistByKey(userId, selectedKey);
    if (!playlist) throw new Error('Không tìm thấy playlist cần thêm bài.');

    return new ModalBuilder()
      .setCustomId(`${PL_MODAL_ADD_URL}:${userId}:${selectedKey}`)
      .setTitle('Thêm bài YouTube')
      .addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(PL_INPUT_URL)
          .setLabel('URL video YouTube')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ));
  }

  function setState(messageId, ownerId, selectedKey, trackPage = 0) {
    const now = Date.now();
    for (const [key, state] of panelState) {
      if (state.expiresAt <= now) panelState.delete(key);
    }
    panelState.set(messageId, {
      ownerId,
      selectedKey,
      trackPage,
      expiresAt: now + PANEL_STATE_TTL_MS,
    });
  }

  function getState(messageId) {
    const state = panelState.get(messageId);
    if (!state) return null;
    if (state.expiresAt <= Date.now()) {
      panelState.delete(messageId);
      return null;
    }
    state.expiresAt = Date.now() + PANEL_STATE_TTL_MS;
    return state;
  }

  return {
    buildAddUrlModal,
    buildCreateModal,
    buildDeleteConfirmationPayload,
    buildImportModal,
    buildPlaylistPanelPayload,
    buildRenameModal,
    buildSaveQueueConfirmationPayload,
    getState,
    setState,
    ids: {
      PL_ADD_CURRENT,
      PL_ADD_URL,
      PL_CREATE,
      PL_DELETE,
      PL_DELETE_CANCEL,
      PL_DELETE_CONFIRM,
      PL_IMPORT,
      PL_INPUT_NAME,
      PL_INPUT_URL,
      PL_MODAL_ADD_URL,
      PL_MODAL_CREATE,
      PL_MODAL_IMPORT,
      PL_MODAL_RENAME,
      PL_PLAY,
      PL_PLAY_INFINITE,
      PL_RENAME,
      PL_SAVE_APPEND,
      PL_SAVE_CANCEL,
      PL_SAVE_QUEUE,
      PL_SAVE_REPLACE,
      PL_SELECT,
      PL_TRACK_NEXT,
      PL_TRACK_PREV,
      PL_TRACK_REMOVE_SELECT,
    },
  };
}

module.exports = {
  createPlaylistPanelService,
};
