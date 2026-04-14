const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { formatDuration } = require('../utils/format');

const BTN_PAUSE_RESUME = 'music_pause_resume';
const BTN_PREVIOUS = 'music_previous';
const BTN_SKIP = 'music_skip';
const BTN_STOP = 'music_stop';
const BTN_QUEUE = 'music_queue';
const BTN_INFINITE = 'music_infinite';

function getQueueSummary(guildState) {
  const lines = [];
  if (guildState.current) lines.push(`Dang phat: ${guildState.current.title}`);
  if (guildState.tracks.length > 0) {
    lines.push('Hang cho:');
    guildState.tracks.slice(0, 10).forEach((t, i) => {
      const duration = t.durationSec ? ` (${formatDuration(t.durationSec)})` : '';
      lines.push(`${i + 1}. ${t.title}${duration}`);
    });
  }
  if (lines.length === 0) lines.push('Hang cho dang trong.');
  return lines.join('\n');
}

function buildNowPlayingEmbed(guildState) {
  const embed = new EmbedBuilder().setColor(0x2b6cb0).setTimestamp(new Date());

  if (!guildState.current) {
    embed
      .setTitle('Now Playing')
      .setDescription('Khong co bai nao dang phat.')
      .addFields({ name: 'Queue', value: `${guildState.tracks.length} bai`, inline: true });
    return embed;
  }

  const durationSec = guildState.current.durationSec || 0;
  const totalTime = durationSec ? formatDuration(durationSec) : 'live';

  embed
    .setTitle('Now Playing')
    .setDescription(`**${guildState.current.title}**`)
    .addFields(
      { name: 'Duration', value: totalTime, inline: true },
      { name: 'Status', value: guildState.isPaused ? 'Paused' : 'Playing', inline: true },
      { name: 'Queue', value: `${guildState.tracks.length} bai`, inline: true },
      { name: 'Requested by', value: guildState.current.requestedBy || 'Unknown', inline: true },
    );

  if (guildState.current.thumbnail) {
    embed.setThumbnail(guildState.current.thumbnail);
  }

  return embed;
}

function buildControlsRows(guildState) {
  const hasCurrent = Boolean(guildState.current);

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_PAUSE_RESUME)
      .setLabel(guildState.isPaused ? 'Resume' : 'Pause')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasCurrent),
    new ButtonBuilder()
      .setCustomId(BTN_PREVIOUS)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasCurrent || !guildState.history || guildState.history.length === 0),
    new ButtonBuilder()
      .setCustomId(BTN_SKIP)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasCurrent),
    new ButtonBuilder()
      .setCustomId(BTN_INFINITE)
      .setLabel(guildState.queueInfiniteMode ? 'Infinite ON' : 'Infinite OFF')
      .setStyle(guildState.queueInfiniteMode ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!hasCurrent && guildState.tracks.length === 0),
    new ButtonBuilder()
      .setCustomId(BTN_STOP)
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasCurrent && guildState.tracks.length === 0),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_QUEUE)
      .setLabel('Queue')
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2];
}

function createNowPlayingPanelService(client) {
  function startProgressTicker(guildState) {
    if (guildState.progressTimer) return;
    guildState.progressTimer = null;
  }

  function stopProgressTicker(guildState) {
    if (!guildState.progressTimer) return;
    clearInterval(guildState.progressTimer);
    guildState.progressTimer = null;
  }

  async function upsertNowPlayingPanel(guildState, preferredChannelId = null) {
    const guild = client.guilds.cache.get(guildState.guildId);
    if (!guild) return;

    if (preferredChannelId) {
      guildState.textChannelId = preferredChannelId;
    }

    const channelId = preferredChannelId || guildState.textChannelId;
    if (!channelId) return;

    let channel = guild.channels.cache.get(channelId);
    if (!channel) {
      channel = await guild.channels.fetch(channelId).catch(() => null);
    }
    if (!channel || !channel.isTextBased()) return;

    const payload = {
      embeds: [buildNowPlayingEmbed(guildState)],
      components: buildControlsRows(guildState),
    };

    if (guildState.panelMessageId && guildState.panelChannelId === channel.id) {
      const oldMsg = await channel.messages.fetch(guildState.panelMessageId).catch(() => null);
      if (oldMsg) {
        await oldMsg.edit(payload).catch(() => null);
        return;
      }
    }

    const sent = await channel.send(payload);
    guildState.panelMessageId = sent.id;
    guildState.panelChannelId = sent.channelId;
  }

  return {
    getQueueSummary,
    startProgressTicker,
    stopProgressTicker,
    upsertNowPlayingPanel,
  };
}

module.exports = {
  BTN_INFINITE,
  BTN_PAUSE_RESUME,
  BTN_PREVIOUS,
  BTN_QUEUE,
  BTN_SKIP,
  BTN_STOP,
  createNowPlayingPanelService,
};
