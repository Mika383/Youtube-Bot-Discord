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

const CONTROL_EMOJIS = Object.freeze({
  nowPlaying: { name: 'ringo_now_playing', id: '1559481039368364073' },
  duration: { name: 'ringo_duration', id: '1559481042627469312' },
  requester: { name: 'ringo_requester', id: '1559481044724351047' },
  previous: { name: 'ringo_previous', id: '1559478126583619646' },
  pause: { name: 'ringo_pause', id: '1559478128345358366' },
  play: { name: 'ringo_play', id: '1559478130216013837' },
  next: { name: 'ringo_next', id: '1559478132510040125' },
  stop: { name: 'ringo_stop', id: '1559478134254866542' },
  queue: { name: 'ringo_queue', id: '1559478136301817876' },
  shuffle: { name: 'ringo_shuffle', id: '1559478138142990456' },
  infinite: { name: 'ringo_infinite', id: '1559478140126892052' },
});

function inlineEmoji(emoji) {
  return `<:${emoji.name}:${emoji.id}>`;
}

function isInfiniteEnabled(guildState) {
  return Boolean(guildState.queueInfiniteMode || guildState.playlistLoopTemplate?.length);
}

function buildNowPlayingEmbed(guildState) {
  const hasCurrent = Boolean(guildState.current);
  const infiniteEnabled = isInfiniteEnabled(guildState);
  const shuffleEnabled = Boolean(guildState.shuffleMode);
  const icons = {
    nowPlaying: inlineEmoji(CONTROL_EMOJIS.nowPlaying),
    duration: inlineEmoji(CONTROL_EMOJIS.duration),
    requester: inlineEmoji(CONTROL_EMOJIS.requester),
    pause: inlineEmoji(CONTROL_EMOJIS.pause),
    play: inlineEmoji(CONTROL_EMOJIS.play),
    queue: inlineEmoji(CONTROL_EMOJIS.queue),
    shuffle: inlineEmoji(CONTROL_EMOJIS.shuffle),
    infinite: inlineEmoji(CONTROL_EMOJIS.infinite),
  };
  const embed = new EmbedBuilder()
    .setColor(hasCurrent ? 0x5865f2 : 0x4f545c)
    .setTitle(`${icons.nowPlaying} ${hasCurrent ? 'Đang phát' : 'Trình phát'}`)
    .setTimestamp(new Date());

  if (!hasCurrent) {
    return embed
      .setDescription('Chưa có bài nào đang phát.')
      .addFields(
        { name: `${icons.queue} Hàng chờ`, value: `${guildState.tracks.length} bài`, inline: true },
        { name: `${icons.shuffle} Trộn bài`, value: shuffleEnabled ? 'BẬT' : 'TẮT', inline: true },
        { name: `${icons.infinite} Lặp vô hạn`, value: infiniteEnabled ? 'BẬT' : 'TẮT', inline: true },
      )
      .setFooter({ text: 'Dùng /play để bắt đầu một phiên nghe nhạc.' });
  }

  const durationSec = guildState.current.durationSec || 0;
  const playbackStatus = guildState.isPaused
    ? `${icons.pause} Tạm dừng`
    : `${icons.play} Đang phát`;

  embed
    .setDescription(`**${truncateText(guildState.current.title, 300)}**`)
    .addFields(
      { name: `${icons.duration} Thời lượng`, value: durationSec ? formatDuration(durationSec) : 'Trực tiếp', inline: true },
      { name: 'Trạng thái', value: playbackStatus, inline: true },
      { name: `${icons.queue} Hàng chờ`, value: `${guildState.tracks.length} bài`, inline: true },
      { name: `${icons.shuffle} Trộn bài`, value: shuffleEnabled ? 'BẬT' : 'TẮT', inline: true },
      { name: `${icons.infinite} Lặp vô hạn`, value: infiniteEnabled ? 'BẬT' : 'TẮT', inline: true },
      {
        name: `${icons.requester} Yêu cầu bởi`,
        value: truncateText(guildState.current.requestedBy || 'Không rõ', 100),
        inline: true,
      },
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
    iconButton(
      BTN_PREVIOUS,
      CONTROL_EMOJIS.previous,
      ButtonStyle.Secondary,
      !hasCurrent || guildState.history.length === 0,
    ),
    iconButton(
      BTN_PAUSE_RESUME,
      guildState.isPaused ? CONTROL_EMOJIS.play : CONTROL_EMOJIS.pause,
      ButtonStyle.Primary,
      !hasCurrent,
    ),
    iconButton(BTN_SKIP, CONTROL_EMOJIS.next, ButtonStyle.Secondary, !hasCurrent),
    iconButton(BTN_STOP, CONTROL_EMOJIS.stop, ButtonStyle.Danger, !hasPlaybackState),
  );

  const modeRow = new ActionRowBuilder().addComponents(
    iconButton(BTN_QUEUE, CONTROL_EMOJIS.queue, ButtonStyle.Secondary),
    iconButton(
      BTN_SHUFFLE,
      CONTROL_EMOJIS.shuffle,
      shuffleEnabled ? ButtonStyle.Success : ButtonStyle.Secondary,
      !hasPlaybackState,
    ),
    iconButton(
      BTN_INFINITE,
      CONTROL_EMOJIS.infinite,
      infiniteEnabled ? ButtonStyle.Success : ButtonStyle.Secondary,
      !hasPlaybackState,
    ),
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
