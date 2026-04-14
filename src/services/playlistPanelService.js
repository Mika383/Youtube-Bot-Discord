const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { formatDuration, truncateLabel } = require('../utils/format');

const PL_SELECT = 'pl_select';
const PL_PLAY = 'pl_play';
const PL_PLAY_INFINITE = 'pl_play_infinite';
const PL_ADD_CURRENT = 'pl_add_current';
const PL_REMOVE_LAST = 'pl_remove_last';
const PL_TRACK_REMOVE_SELECT = 'pl_track_remove_select';
const PL_DELETE = 'pl_delete';
const PL_REFRESH = 'pl_refresh';
const PL_SAVE_QUEUE = 'pl_save_queue';

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
        : selected.tracks.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}${t.durationSec ? ` (${formatDuration(t.durationSec)})` : ''}`).join('\n');

      embed
        .setDescription(`**${selected.name}**`)
        .addFields(
          { name: 'Tong bai', value: String(selected.tracks.length), inline: true },
          { name: 'Now playing', value: guildState.current ? guildState.current.title : 'Khong co', inline: true },
          { name: 'Preview', value: preview },
        );
    }

    if (note) {
      embed.setFooter({ text: note });
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

  function setState(messageId, ownerId, selectedKey) {
    panelState.set(messageId, { ownerId, selectedKey });
  }

  function getState(messageId) {
    return panelState.get(messageId) || null;
  }

  return {
    buildPlaylistPanelPayload,
    getState,
    setState,
    ids: {
      PL_ADD_CURRENT,
      PL_DELETE,
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
