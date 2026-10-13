const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { formatDuration, truncateLabel, truncateText } = require('../utils/format');

const PL_SELECT = 'pl_select';
const PL_PLAY = 'pl_play';
const PL_PLAY_INFINITE = 'pl_play_infinite';
const PL_ADD_CURRENT = 'pl_add_current';
const PL_REMOVE_LAST = 'pl_remove_last';
const PL_TRACK_REMOVE_SELECT = 'pl_track_remove_select';
const PL_DELETE = 'pl_delete';
const PL_DELETE_CONFIRM = 'pl_delete_confirm';
const PL_DELETE_CANCEL = 'pl_delete_cancel';
const PL_REFRESH = 'pl_refresh';
const PL_SAVE_QUEUE = 'pl_save_queue';
const PANEL_STATE_TTL_MS = 30 * 60 * 1000;

function createPlaylistPanelService(playlistStore) {
  const panelState = new Map();

  function buildPlaylistPanelPayload(userId, selectedKey, guildState, note = null) {
    const playlists = playlistStore.listUserPlaylists(userId);
    const hasAny = playlists.length > 0;
    const selected = hasAny ? (playlists.find((p) => p.key === selectedKey) || playlists[0]) : null;

    const embed = new EmbedBuilder()
      .setColor(0x198754)
      .setTitle('My Playlist')
      .setTimestamp(new Date());

    if (!selected) {
      embed.setDescription('Ban chua co playlist nao. Dung /cpl create de tao playlist dau tien.');
    } else {
      const preview = selected.tracks.length === 0
        ? 'Playlist dang trong.'
        : selected.tracks.slice(0, 10).map((t, i) => `${i + 1}. ${truncateText(t.title, 80)}${t.durationSec ? ` (${formatDuration(t.durationSec)})` : ''}`).join('\n');

      embed
        .setDescription(`**${selected.name}**`)
        .addFields(
          { name: 'Tong bai', value: String(selected.tracks.length), inline: true },
          { name: 'Now playing', value: guildState.current ? truncateText(guildState.current.title, 200) : 'Khong co', inline: true },
          { name: 'Preview', value: truncateText(preview, 1024) },
        );
    }

    if (note) {
      embed.setFooter({ text: truncateText(note, 500) });
    }

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${PL_SELECT}:${userId}`)
        .setPlaceholder('Chon playlist de thao tac')
        .setDisabled(!hasAny)
        .addOptions(
          hasAny
            ? playlists.slice(0, 25).map((p) => ({
              label: truncateLabel(p.name, 80),
              value: p.key,
              description: `${p.tracks.length} bai`,
              default: selected ? p.key === selected.key : false,
            }))
            : [{ label: 'No playlists', value: 'none', description: 'Create one first' }],
        ),
    );

    const actionRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PL_PLAY}:${userId}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('Play')
        .setDisabled(!selected || selected.tracks.length === 0),
      new ButtonBuilder()
        .setCustomId(`${PL_PLAY_INFINITE}:${userId}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel('Play Infinite')
        .setDisabled(!selected || selected.tracks.length === 0),
      new ButtonBuilder()
        .setCustomId(`${PL_SAVE_QUEUE}:${userId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Save Queue')
        .setDisabled(!selected),
      new ButtonBuilder()
        .setCustomId(`${PL_ADD_CURRENT}:${userId}`)
        .setStyle(ButtonStyle.Success)
        .setLabel('Add Current')
        .setDisabled(!selected || !guildState.current),
    );

    const manageRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PL_REMOVE_LAST}:${userId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Remove Last')
        .setDisabled(!selected || selected.tracks.length === 0),
      new ButtonBuilder()
        .setCustomId(`${PL_DELETE}:${userId}`)
        .setStyle(ButtonStyle.Danger)
        .setLabel('Delete Playlist')
        .setDisabled(!selected),
      new ButtonBuilder()
        .setCustomId(`${PL_REFRESH}:${userId}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel('Refresh'),
    );

    const trackRow = selected && selected.tracks.length > 0
      ? new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PL_TRACK_REMOVE_SELECT}:${userId}`)
          .setPlaceholder('Xoa bai theo vi tri (chon bai can xoa)')
          .addOptions(
            selected.tracks.slice(0, 25).map((t, i) => ({
              label: truncateLabel(`${i + 1}. ${t.title}`, 100),
              value: String(i + 1),
              description: t.durationSec ? formatDuration(t.durationSec) : 'unknown duration',
            })),
          ),
      )
      : null;

    const components = [selectRow, actionRow, manageRow];
    if (trackRow) components.push(trackRow);

    return { selectedKey: selected?.key || null, payload: { embeds: [embed], components } };
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

  function setState(messageId, ownerId, selectedKey) {
    const now = Date.now();
    for (const [key, state] of panelState) {
      if (state.expiresAt <= now) panelState.delete(key);
    }
    panelState.set(messageId, { ownerId, selectedKey, expiresAt: now + PANEL_STATE_TTL_MS });
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
    buildPlaylistPanelPayload,
    buildDeleteConfirmationPayload,
    getState,
    setState,
    ids: {
      PL_ADD_CURRENT,
      PL_DELETE,
      PL_DELETE_CANCEL,
      PL_DELETE_CONFIRM,
      PL_PLAY,
      PL_PLAY_INFINITE,
      PL_REFRESH,
      PL_REMOVE_LAST,
      PL_SELECT,
      PL_SAVE_QUEUE,
      PL_TRACK_REMOVE_SELECT,
    },
  };
}

module.exports = {
  createPlaylistPanelService,
};
