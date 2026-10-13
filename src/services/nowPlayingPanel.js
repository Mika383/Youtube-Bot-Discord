const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { formatDuration, truncateText } = require('../utils/format');

const BTN_PAUSE_RESUME = 'music_pause_resume';
const BTN_PREVIOUS = 'music_previous';
const BTN_SKIP = 'music_skip';
const BTN_STOP = 'music_stop';
const BTN_QUEUE = 'music_queue';
const BTN_INFINITE = 'music_infinite';
const BTN_SHUFFLE = 'music_shuffle';
// Retained so controls from older messages can fail with a clear response.
const BTN_SHUFFLE_INFINITE = 'music_shuffle_infinite';

function isInfiniteEnabled(guildState) {
  return Boolean(guildState.queueInfiniteMode || guildState.playlistLoopTemplate?.length);
}

function buildNowPlayingEmbed(guildState) {
  const hasCurrent = Boolean(guildState.current);
  const infiniteEnabled = isInfiniteEnabled(guildState);
  const shuffleEnabled = Boolean(guildState.shuffleMode);
  const embed = new EmbedBuilder()
    .setColor(hasCurrent ? 0x5865f2 : 0x4f545c)
    .setTitle(hasCurrent ? '🎧 Đang phát' : '🎵 Trình phát')
    .setTimestamp(new Date());

  if (!hasCurrent) {
    return embed
      .setDescription('Chưa có bài nào đang phát.')
      .addFields(
        { name: '📜 Hàng chờ', value: `${guildState.tracks.length} bài`, inline: true },
        { name: '🔀 Shuffle', value: shuffleEnabled ? 'BẬT' : 'TẮT', inline: true },
        { name: '🔁 Infinite', value: infiniteEnabled ? 'BẬT' : 'TẮT', inline: true },
      )
      .setFooter({ text: 'Dùng /play để bắt đầu một phiên nghe nhạc.' });
  }

  const durationSec = guildState.current.durationSec || 0;
  const playbackStatus = guildState.isPaused ? '⏸️ Tạm dừng' : '▶️ Đang phát';

  embed
    .setDescription(`**${truncateText(guildState.current.title, 300)}**`)
    .addFields(
      { name: '⏱️ Thời lượng', value: durationSec ? formatDuration(durationSec) : 'Live', inline: true },
      { name: 'Trạng thái', value: playbackStatus, inline: true },
      { name: '📜 Hàng chờ', value: `${guildState.tracks.length} bài`, inline: true },
      { name: '🔀 Shuffle', value: shuffleEnabled ? 'BẬT' : 'TẮT', inline: true },
      { name: '🔁 Infinite', value: infiniteEnabled ? 'BẬT' : 'TẮT', inline: true },
      { name: '👤 Yêu cầu bởi', value: truncateText(guildState.current.requestedBy || 'Không rõ', 100), inline: true },
    )
    .setFooter({ text: 'Các nút màu xanh lá đang được bật.' });

  if (guildState.current.thumbnail) {
    embed.setThumbnail(guildState.current.thumbnail);
  }

  return embed;
}

function iconButton(customId, emoji, style, disabled = false) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setEmoji(emoji)
    .setStyle(style)
    .setDisabled(disabled);
}

function buildControlsRows(guildState) {
  const hasCurrent = Boolean(guildState.current);
  const hasPlaybackState = hasCurrent || guildState.tracks.length > 0;
  const infiniteEnabled = isInfiniteEnabled(guildState);
  const shuffleEnabled = Boolean(guildState.shuffleMode);

  const primaryRow = new ActionRowBuilder().addComponents(
    iconButton(BTN_PREVIOUS, '⏮️', ButtonStyle.Secondary, !hasCurrent || guildState.history.length === 0),
    iconButton(BTN_PAUSE_RESUME, guildState.isPaused ? '▶️' : '⏸️', ButtonStyle.Primary, !hasCurrent),
    iconButton(BTN_SKIP, '⏭️', ButtonStyle.Secondary, !hasCurrent),
    iconButton(BTN_STOP, '⏹️', ButtonStyle.Danger, !hasPlaybackState),
  );

  const modeRow = new ActionRowBuilder().addComponents(
    iconButton(BTN_QUEUE, '📜', ButtonStyle.Secondary),
    iconButton(BTN_SHUFFLE, '🔀', shuffleEnabled ? ButtonStyle.Success : ButtonStyle.Secondary, !hasPlaybackState),
    iconButton(BTN_INFINITE, '🔁', infiniteEnabled ? ButtonStyle.Success : ButtonStyle.Secondary, !hasPlaybackState),
  );

  return [primaryRow, modeRow];
}

function createNowPlayingPanelService(client) {
  const panelOperations = new Map();

  function runSerialized(guildId, operation) {
    const previous = panelOperations.get(guildId) || Promise.resolve();
    const current = previous.catch(() => null).then(operation);
    panelOperations.set(guildId, current);
    return current.finally(() => {
      if (panelOperations.get(guildId) === current) panelOperations.delete(guildId);
    });
  }

  async function resolveChannel(guild, channelId) {
    if (!channelId) return null;
    const cached = guild.channels.cache.get(channelId);
    const channel = cached || await guild.channels.fetch(channelId).catch(() => null);
    return channel?.isTextBased() ? channel : null;
  }

  async function fetchPanelMessage(guild, channelId, messageId) {
    if (!channelId || !messageId) return null;
    const channel = await resolveChannel(guild, channelId);
    if (!channel?.messages) return null;
    return channel.messages.fetch(messageId).catch(() => null);
  }

  function buildPayload(guildState) {
    return {
      embeds: [buildNowPlayingEmbed(guildState)],
      components: buildControlsRows(guildState),
      allowedMentions: { parse: [] },
    };
  }

  async function upsertNowPlayingPanel(guildState, preferredChannelId = null) {
    return runSerialized(guildState.guildId, async () => {
      const guild = client.guilds.cache.get(guildState.guildId);
      if (!guild) return null;

      if (preferredChannelId) guildState.textChannelId = preferredChannelId;
      const channel = await resolveChannel(guild, preferredChannelId || guildState.textChannelId);
      if (!channel) return null;

      if (guildState.panelMessageId && guildState.panelChannelId === channel.id) {
        const existing = await fetchPanelMessage(guild, channel.id, guildState.panelMessageId);
        if (existing) {
          await existing.edit(buildPayload(guildState));
          return existing;
        }
      }

      const sent = await channel.send(buildPayload(guildState));
      guildState.panelMessageId = sent.id;
      guildState.panelChannelId = sent.channelId;
      return sent;
    });
  }

  async function relocateNowPlayingPanel(guildState, preferredChannelId = null) {
    return runSerialized(guildState.guildId, async () => {
      const guild = client.guilds.cache.get(guildState.guildId);
      if (!guild) return null;

      if (preferredChannelId) guildState.textChannelId = preferredChannelId;
      const channel = await resolveChannel(guild, preferredChannelId || guildState.textChannelId);
      if (!channel) return null;

      const oldMessageId = guildState.panelMessageId;
      const oldChannelId = guildState.panelChannelId;
      const sent = await channel.send(buildPayload(guildState));
      guildState.panelMessageId = sent.id;
      guildState.panelChannelId = sent.channelId;

      const oldMessage = await fetchPanelMessage(guild, oldChannelId, oldMessageId);
      if (oldMessage && oldMessage.id !== sent.id) {
        const deleted = await oldMessage.delete().then(() => true).catch(() => false);
        if (!deleted) await oldMessage.edit({ components: [] }).catch(() => null);
      }

      return sent;
    });
  }

  return {
    relocateNowPlayingPanel,
    upsertNowPlayingPanel,
  };
}

module.exports = {
  BTN_INFINITE,
  BTN_PAUSE_RESUME,
  BTN_PREVIOUS,
  BTN_QUEUE,
  BTN_SHUFFLE,
  BTN_SHUFFLE_INFINITE,
  BTN_SKIP,
  BTN_STOP,
  buildControlsRows,
  buildNowPlayingEmbed,
  createNowPlayingPanelService,
  isInfiniteEnabled,
};
