const { EmbedBuilder } = require('discord.js');
const { formatDuration } = require('../utils/format');
const { createLogger } = require('../utils/logger');
const {
  BTN_INFINITE,
  BTN_PAUSE_RESUME,
  BTN_PREVIOUS,
  BTN_QUEUE,
  BTN_SKIP,
  BTN_STOP,
} = require('../services/nowPlayingPanel');

const logger = createLogger('interaction');

function buildRingoHelpEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('/ringo - Huong Dan Lenh Bot')
    .setDescription('Danh sach toan bo lenh hien co va cach dung nhanh.')
    .addFields(
      {
        name: 'Music',
        value: [
          '`/play url input:<youtube_url>`: Them bai vao queue va phat.',
          '`/play search input:<ten bai>`: Tim theo ten roi phat.',
          '`/play myplaylist name:<ten> [infinite]`: Phat ngay playlist da luu.',
          '`/play playlist url:<youtube_playlist_url> [infinite]`: Phat playlist YouTube.',
          '`/skip`: Bo qua bai hien tai.',
          '`/stop`: Dung phat, xoa queue, ngat voice.',
          '`/kill`: Huy phat nhac va roi voice channel ngay lap tuc o bat ki dau.',
          '`/queue`: Xem queue hien tai.',
          '`/leave`: Bot roi voice channel.',
          '`/present`: Ve lai UI Now Playing khi panel bi loi/mat.',
        ].join('\n'),
      },
      {
        name: 'Playlist Create',
        value: [
          '`/createplaylist create name:<ten>` hoac `/cpl create ...`: Tao playlist.',
          '`/createplaylist import name:<ten> url:<playlist_url>`: Tao playlist tu YouTube playlist.',
          '`/createplaylist delete name:<ten>` hoac `/cpl delete ...`: Xoa playlist.',
          '`/createplaylist rename name:<cu> new_name:<moi>` hoac `/cpl rename ...`: Doi ten.',
        ].join('\n'),
      },
      {
        name: 'Playlist Use',
        value: [
          '`/myplaylist panel` hoac `/mpl panel`: Mo UI quan ly playlist.',
          '`/myplaylist list` hoac `/mpl list`: Liet ke playlist cua ban.',
          '`/myplaylist view name:<ten>`: Xem bai trong playlist.',
          '`/myplaylist add name:<ten> url:<youtube_url>`: Them bai vao playlist.',
          '`/myplaylist remove name:<ten> index:<so>`: Xoa bai theo vi tri.',
          '`/myplaylist play name:<ten> [infinite]`: Play playlist/lap vo han.',
          '`/myplaylist savequeue name:<ten> [mode]`: Luu bai dang phat + queue vao playlist.',
        ].join('\n'),
      },
      {
        name: 'Luu y quyen han',
        value: 'Playlist gan theo tai khoan Discord. User khac khong the sua/xoa playlist cua ban.',
      },
    )
    .setFooter({ text: 'Tip: Mo /mpl panel de thao tac playlist bang nut va select menu.' })
    .setTimestamp(new Date());
}

function buildQueueEmbed(guildState) {
  const embed = new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle('Queue')
    .setTimestamp(new Date());

  if (!guildState.current && guildState.tracks.length === 0) {
    embed.setDescription('Hang cho dang trong.');
    return embed;
  }

  if (guildState.current) {
    embed.addFields({
      name: 'Dang phat',
      value: `${guildState.current.title}${guildState.current.durationSec ? ` (${formatDuration(guildState.current.durationSec)})` : ''}`,
    });
  }

  if (guildState.tracks.length > 0) {
    const list = guildState.tracks
      .slice(0, 12)
      .map((t, i) => `${i + 1}. ${t.title}${t.durationSec ? ` (${formatDuration(t.durationSec)})` : ''}`)
      .join('\n');
    embed.addFields({ name: `Hang cho (${guildState.tracks.length} bai)`, value: list });
  }

  return embed;
}

function createInteractionHandler({
  playerService,
  panelService,
  playlistStore,
  playlistPanelService,
  youtubeService,
}) {
  const { ids } = playlistPanelService;

  function buildInteractionMeta(interaction, extra = {}) {
    let subcommand = null;
    if (interaction?.isChatInputCommand?.()) {
      try {
        subcommand = interaction.options.getSubcommand(false);
      } catch {
        subcommand = null;
      }
    }

    return {
      interactionType: interaction?.type || null,
      commandName: interaction?.commandName || null,
      subcommand,
      customId: interaction?.customId || null,
      guildId: interaction?.guildId || null,
      channelId: interaction?.channelId || null,
      userId: interaction?.user?.id || null,
      username: interaction?.user?.username || null,
      messageId: interaction?.message?.id || null,
      values: interaction?.values || null,
      memberVoiceChannelId: interaction?.member?.voice?.channelId || null,
      deferred: Boolean(interaction?.deferred),
      replied: Boolean(interaction?.replied),
      ...extra,
    };
  }

  function getQueueSnapshot(guildState) {
    const snapshot = [];
    if (guildState.current) snapshot.push(guildState.current);
    if (guildState.tracks.length > 0) snapshot.push(...guildState.tracks);
    return snapshot.map((track) => ({
      url: track.url,
      title: track.title,
      durationSec: track.durationSec || 0,
      thumbnail: track.thumbnail || null,
    }));
  }

  async function handleCreatePlaylistCommands(interaction) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    logger.info('Handling createplaylist subcommand.', buildInteractionMeta(interaction, { sub }));

    if (sub === 'create') {
      const name = interaction.options.getString('name', true);
      const created = playlistStore.createPlaylist(userId, name);
      logger.info('Playlist created.', buildInteractionMeta(interaction, {
        playlistName: created.name,
        playlistKey: created.key,
      }));
      await interaction.reply({ content: `Da tao playlist: **${created.name}**`, ephemeral: true });
      return;
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name', true);
      playlistStore.deletePlaylist(userId, name);
      logger.info('Playlist deleted.', buildInteractionMeta(interaction, {
        playlistName: playlistStore.normalizePlaylistName(name),
      }));
      await interaction.reply({ content: `Da xoa playlist: **${playlistStore.normalizePlaylistName(name)}**`, ephemeral: true });
      return;
    }

    if (sub === 'rename') {
      const oldName = interaction.options.getString('name', true);
      const newName = interaction.options.getString('new_name', true);
      const renamed = playlistStore.renamePlaylist(userId, oldName, newName);
      logger.info('Playlist renamed.', buildInteractionMeta(interaction, {
        oldName,
        newName: renamed.name,
      }));
      await interaction.reply({ content: `Da doi ten playlist thanh: **${renamed.name}**`, ephemeral: true });
      return;
    }

    if (sub === 'import') {
      await interaction.deferReply({ ephemeral: true });
      const name = interaction.options.getString('name', true);
      const inputUrl = interaction.options.getString('url', true);
      logger.info('Importing YouTube playlist into local playlist.', buildInteractionMeta(interaction, {
        playlistName: name,
        inputUrl,
      }));

      if (playlistStore.getPlaylistByName(userId, name)) {
        throw new Error('Playlist da ton tai. Hay dung ten khac hoac xoa playlist cu.');
      }

      const imported = await youtubeService.fetchYoutubePlaylistTracks(inputUrl);
      const created = playlistStore.createPlaylist(userId, name);
      const cappedTracks = imported.tracks.slice(0, playlistStore.MAX_TRACKS_PER_PLAYLIST);
      playlistStore.addTracksToPlaylist(userId, created.key, cappedTracks);
      logger.info('Playlist import completed.', buildInteractionMeta(interaction, {
        playlistName: created.name,
        sourceTitle: imported.title,
        importedTrackCount: imported.tracks.length,
        storedTrackCount: cappedTracks.length,
      }));

      const note = imported.tracks.length > cappedTracks.length
        ? ` (gioi han ${playlistStore.MAX_TRACKS_PER_PLAYLIST} bai)`
        : '';
      const notice = imported.notice ? `\nLuu y: ${imported.notice}` : '';
      await interaction.editReply(
        `Da tao playlist **${created.name}** tu **${imported.title}** voi ${cappedTracks.length} bai${note}.${notice}`,
      );
    }
  }

  async function handleMyPlaylistCommands(interaction, guildState) {
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    logger.info('Handling myplaylist subcommand.', buildInteractionMeta(interaction, {
      sub,
      currentTitle: guildState.current?.title || null,
      queueLength: guildState.tracks.length,
    }));

    if (sub === 'panel') {
      const panel = playlistPanelService.buildPlaylistPanelPayload(userId, null, guildState);
      logger.info('Opening playlist panel.', buildInteractionMeta(interaction, { selectedKey: panel.selectedKey }));
      await interaction.reply({ ...panel.payload, ephemeral: true });
      const reply = await interaction.fetchReply();
      playlistPanelService.setState(reply.id, userId, panel.selectedKey);
      return;
    }

    if (sub === 'list') {
      const playlists = playlistStore.listUserPlaylists(userId);
      if (playlists.length === 0) {
        await interaction.reply({ content: 'Ban chua co playlist nao. Dung /cpl create de tao playlist.', ephemeral: true });
        return;
      }
      const text = playlists.map((p, i) => `${i + 1}. ${p.name} (${p.tracks.length} bai)`).join('\n');
      await interaction.reply({ content: text, ephemeral: true });
      return;
    }

    if (sub === 'view') {
      const name = interaction.options.getString('name', true);
      const playlist = playlistStore.getPlaylistByName(userId, name);
      if (!playlist) throw new Error('Khong tim thay playlist.');

      const embed = new EmbedBuilder()
        .setColor(0x198754)
        .setTitle(`Playlist: ${playlist.name}`)
        .setDescription(
          playlist.tracks.length === 0
            ? 'Playlist dang trong.'
            : playlist.tracks.slice(0, 20).map((t, i) => `${i + 1}. ${t.title}${t.durationSec ? ` (${formatDuration(t.durationSec)})` : ''}`).join('\n'),
        )
        .setFooter({ text: `Tong ${playlist.tracks.length} bai` })
        .setTimestamp(new Date());
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (sub === 'add') {
      await interaction.deferReply({ ephemeral: true });
      const name = interaction.options.getString('name', true);
      const rawUrl = interaction.options.getString('url', true);
      logger.info('Adding track to local playlist.', buildInteractionMeta(interaction, {
        playlistName: name,
        rawUrl,
      }));
      const url = youtubeService.normalizePlayableUrl(rawUrl);
      const meta = await youtubeService.getVideoMetadata(url);
      const playlist = playlistStore.addTrackToPlaylist(userId, name, {
        url,
        title: meta.title,
        durationSec: meta.durationSec,
        thumbnail: meta.thumbnail,
      });
      logger.info('Track added to local playlist.', buildInteractionMeta(interaction, {
        playlistName: playlist.name,
        trackTitle: meta.title,
        trackUrl: url,
      }));
      await interaction.editReply(`Da them vao playlist **${playlist.name}**: ${meta.title}`);
      return;
    }

    if (sub === 'remove') {
      const name = interaction.options.getString('name', true);
      const index = interaction.options.getInteger('index', true);
      const removed = playlistStore.removeTrackByIndex(userId, name, index);
      await interaction.reply({ content: `Da xoa bai: ${removed.title}`, ephemeral: true });
      return;
    }

    if (sub === 'play') {
      await interaction.deferReply();
      const name = interaction.options.getString('name', true);
      const infinite = interaction.options.getBoolean('infinite') || false;
      const playlist = playlistStore.getPlaylistByName(userId, name);
      if (!playlist) throw new Error('Khong tim thay playlist.');
      if (playlist.tracks.length === 0) throw new Error('Playlist dang trong.');
      logger.info('Playing saved local playlist.', buildInteractionMeta(interaction, {
        playlistName: playlist.name,
        trackCount: playlist.tracks.length,
        infinite,
      }));

      await playerService.ensureConnection(interaction, guildState);
      playerService.enqueuePlaylistToGuildWithOptions(guildState, playlist, interaction.user.username, { shuffle: false });
      playerService.configurePlaylistLoop(guildState, playlist, interaction.user.username, { infinite, shuffle: false });
      if (!guildState.current) {
        await playerService.playNext(interaction, guildState);
      }
      await panelService.upsertNowPlayingPanel(guildState);
      await interaction.followUp({
        content: `Da nap playlist **${playlist.name}** (${playlist.tracks.length} bai). Infinite: **${infinite ? 'ON' : 'OFF'}**.`,
      });
      return;
    }

    if (sub === 'savequeue') {
      const targetName = interaction.options.getString('name', true);
      const mode = interaction.options.getString('mode') || 'replace';
      const snapshot = getQueueSnapshot(guildState);
      if (snapshot.length === 0) throw new Error('Queue hien tai dang trong.');
      logger.info('Saving queue into local playlist.', buildInteractionMeta(interaction, {
        targetName,
        mode,
        snapshotLength: snapshot.length,
      }));

      let playlist = playlistStore.getPlaylistByName(userId, targetName);
      if (!playlist) {
        playlist = playlistStore.createPlaylist(userId, targetName);
      }

      if (mode === 'append') {
        playlist = playlistStore.addTracksToPlaylist(userId, playlist.key, snapshot);
      } else {
        playlist = playlistStore.replacePlaylistTracks(userId, playlist.key, snapshot);
      }

      await interaction.reply({
        content: `Da luu ${snapshot.length} bai vao playlist **${playlist.name}** (mode: ${mode}).`,
        ephemeral: true,
      });
      logger.info('Queue saved into local playlist.', buildInteractionMeta(interaction, {
        playlistName: playlist.name,
        mode,
        snapshotLength: snapshot.length,
      }));
    }
  }

  async function handle(interaction) {
    logger.info('Interaction received.', buildInteractionMeta(interaction));

    if (interaction.guildId && interaction.channelId) {
      playerService.setActiveTextChannel(interaction.guildId, interaction.channelId);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${ids.PL_SELECT}:`)) {
      const ownerId = interaction.customId.split(':')[1];
      if (interaction.user.id !== ownerId) {
        logger.warn('Rejected playlist select interaction because owner did not match.', buildInteractionMeta(interaction, { ownerId }));
        await interaction.reply({ content: 'Day khong phai playlist panel cua ban.', ephemeral: true });
        return;
      }

      const guildState = playerService.getGuildState(interaction.guildId);
      const selectedKey = interaction.values[0];
      logger.info('Playlist select menu changed.', buildInteractionMeta(interaction, { selectedKey }));
      const panel = playlistPanelService.buildPlaylistPanelPayload(ownerId, selectedKey, guildState);
      playlistPanelService.setState(interaction.message.id, ownerId, panel.selectedKey);
      await interaction.update(panel.payload);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${ids.PL_TRACK_REMOVE_SELECT}:`)) {
      const ownerId = interaction.customId.split(':')[1];
      if (interaction.user.id !== ownerId) {
        logger.warn('Rejected playlist remove-track interaction because owner did not match.', buildInteractionMeta(interaction, { ownerId }));
        await interaction.reply({ content: 'Day khong phai playlist panel cua ban.', ephemeral: true });
        return;
      }

      const guildState = playerService.getGuildState(interaction.guildId);
      const state = playlistPanelService.getState(interaction.message.id) || { ownerId, selectedKey: null };
      const selectedKey = state.selectedKey || playlistStore.listUserPlaylists(ownerId)[0]?.key || null;
      if (!selectedKey) {
        await interaction.reply({ content: 'Ban chua co playlist de thao tac.', ephemeral: true });
        return;
      }

      const index = Number(interaction.values[0]);
      logger.info('Playlist remove-track menu used.', buildInteractionMeta(interaction, { selectedKey, index }));
      const removed = playlistStore.removeTrackByIndex(ownerId, selectedKey, index);
      const panel = playlistPanelService.buildPlaylistPanelPayload(ownerId, selectedKey, guildState, `Da xoa: ${removed.title}`);
      playlistPanelService.setState(interaction.message.id, ownerId, panel.selectedKey);
      await interaction.update(panel.payload);
      return;
    }

    if (interaction.isButton()) {
      const guildState = playerService.getGuildState(interaction.guildId);
      logger.info('Button interaction received.', buildInteractionMeta(interaction, {
        currentTitle: guildState.current?.title || null,
        queueLength: guildState.tracks.length,
      }));

      try {
        if (interaction.customId === BTN_QUEUE) {
          await interaction.reply({ embeds: [buildQueueEmbed(guildState)], ephemeral: true });
          return;
        }

        if (interaction.customId === BTN_PAUSE_RESUME
          || interaction.customId === BTN_PREVIOUS
          || interaction.customId === BTN_SKIP
          || interaction.customId === BTN_INFINITE
          || interaction.customId === BTN_STOP) {
          playerService.requireSameVoiceChannel(interaction, guildState);
        }

        if (interaction.customId === BTN_PAUSE_RESUME) {
          if (!guildState.current) {
            await interaction.reply({ content: 'Khong co bai nao dang phat.', ephemeral: true });
            return;
          }

          if (guildState.isPaused) {
            guildState.player.unpause();
            guildState.isPaused = false;
            guildState.currentStartedAtMs = Date.now() - guildState.pausedElapsedMs;
            await interaction.reply({ content: 'Da tiep tuc phat.', ephemeral: true });
          } else {
            guildState.player.pause(true);
            guildState.isPaused = true;
            guildState.pausedElapsedMs = Math.max(0, Date.now() - guildState.currentStartedAtMs);
            await interaction.reply({ content: 'Da tam dung.', ephemeral: true });
          }

          await panelService.upsertNowPlayingPanel(guildState);
          return;
        }

        if (interaction.customId === BTN_SKIP) {
          if (!guildState.current) {
            await interaction.reply({ content: 'Khong co bai nao dang phat.', ephemeral: true });
            return;
          }
          guildState.player.stop();
          await interaction.reply({ content: 'Da skip bai hien tai.', ephemeral: true });
          return;
        }

        if (interaction.customId === BTN_PREVIOUS) {
          playerService.playPrevious(guildState);
          await interaction.reply({ content: 'Da quay lai bai truoc.', ephemeral: true });
          return;
        }

        if (interaction.customId === BTN_INFINITE) {
          const status = playerService.toggleInfiniteMode(guildState);
          await panelService.upsertNowPlayingPanel(guildState);
          await interaction.reply({ content: `Infinite ${status ? 'ON' : 'OFF'}.`, ephemeral: true });
          return;
        }

        if (interaction.customId === BTN_STOP) {
          playerService.clearAndDisconnect(guildState);
          await panelService.upsertNowPlayingPanel(guildState);
          await interaction.reply({ content: 'Da dung nhac va xoa hang cho.', ephemeral: true });
          return;
        }

        if (interaction.customId.startsWith('pl_')) {
          const [action, ownerId] = interaction.customId.split(':');
          if (!ownerId) throw new Error('Playlist action khong hop le.');
          if (interaction.user.id !== ownerId) {
            logger.warn('Rejected playlist button because owner did not match.', buildInteractionMeta(interaction, { ownerId, action }));
            await interaction.reply({ content: 'Day khong phai playlist panel cua ban.', ephemeral: true });
            return;
          }

          const state = playlistPanelService.getState(interaction.message.id) || { ownerId, selectedKey: null };
          const selectedKey = state.selectedKey || playlistStore.listUserPlaylists(ownerId)[0]?.key || null;

          if (action === ids.PL_REFRESH) {
            const panel = playlistPanelService.buildPlaylistPanelPayload(ownerId, selectedKey, guildState);
            playlistPanelService.setState(interaction.message.id, ownerId, panel.selectedKey);
            await interaction.update(panel.payload);
            return;
          }

          if (!selectedKey) {
            await interaction.reply({ content: 'Ban chua co playlist de thao tac.', ephemeral: true });
            return;
          }

          if (action === ids.PL_PLAY || action === ids.PL_PLAY_INFINITE) {
            await interaction.deferUpdate();
            const playlist = playlistStore.getPlaylistByKey(ownerId, selectedKey);
            if (!playlist || playlist.tracks.length === 0) throw new Error('Playlist dang trong.');
            const infinite = action === ids.PL_PLAY_INFINITE;
            logger.info('Playlist panel requested playback.', buildInteractionMeta(interaction, {
              selectedKey,
              playlistName: playlist.name,
              trackCount: playlist.tracks.length,
              infinite,
            }));

            await playerService.ensureConnection(interaction, guildState);
            playerService.enqueuePlaylistToGuildWithOptions(guildState, playlist, interaction.user.username, { shuffle: false });
            playerService.configurePlaylistLoop(guildState, playlist, interaction.user.username, { infinite, shuffle: false });
            if (!guildState.current) {
              await playerService.playNext(null, guildState);
            }

            const panel = playlistPanelService.buildPlaylistPanelPayload(
              ownerId,
              selectedKey,
              guildState,
              `Da nap playlist ${playlist.name}. Infinite: ${infinite ? 'ON' : 'OFF'}.`,
            );
            playlistPanelService.setState(interaction.message.id, ownerId, panel.selectedKey);
            await interaction.editReply(panel.payload);
            return;
          }

          if (action === ids.PL_ADD_CURRENT) {
            if (!guildState.current) throw new Error('Khong co bai dang phat de them.');
            playlistStore.addTrackToPlaylist(ownerId, selectedKey, guildState.current);
            const panel = playlistPanelService.buildPlaylistPanelPayload(ownerId, selectedKey, guildState, `Da them: ${guildState.current.title}`);
            playlistPanelService.setState(interaction.message.id, ownerId, panel.selectedKey);
            await interaction.update(panel.payload);
            return;
          }

          if (action === ids.PL_REMOVE_LAST) {
            const removed = playlistStore.removeLastTrack(ownerId, selectedKey);
            const panel = playlistPanelService.buildPlaylistPanelPayload(ownerId, selectedKey, guildState, `Da xoa: ${removed.title}`);
            playlistPanelService.setState(interaction.message.id, ownerId, panel.selectedKey);
            await interaction.update(panel.payload);
            return;
          }

          if (action === ids.PL_SAVE_QUEUE) {
            const playlist = playlistStore.getPlaylistByKey(ownerId, selectedKey);
            if (!playlist) throw new Error('Khong tim thay playlist.');
            const snapshot = getQueueSnapshot(guildState);
            if (snapshot.length === 0) throw new Error('Queue hien tai dang trong.');
            const updated = playlistStore.replacePlaylistTracks(ownerId, selectedKey, snapshot);
            const panel = playlistPanelService.buildPlaylistPanelPayload(ownerId, selectedKey, guildState, `Da save ${snapshot.length} bai vao ${updated.name}`);
            playlistPanelService.setState(interaction.message.id, ownerId, panel.selectedKey);
            await interaction.update(panel.payload);
            return;
          }

          if (action === ids.PL_DELETE) {
            const name = playlistStore.getUserPlaylistMap(ownerId)[selectedKey]?.name || selectedKey;
            playlistStore.deletePlaylist(ownerId, selectedKey);
            const fallback = playlistStore.listUserPlaylists(ownerId)[0]?.key || null;
            const panel = playlistPanelService.buildPlaylistPanelPayload(ownerId, fallback, guildState, `Da xoa playlist: ${name}`);
            playlistPanelService.setState(interaction.message.id, ownerId, panel.selectedKey);
            await interaction.update(panel.payload);
            return;
          }
        }
      } catch (error) {
        logger.error('Button interaction failed.', buildInteractionMeta(interaction, { error }));
        const content = `Loi: ${error.message || 'khong ro nguyen nhan'}`;
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content, ephemeral: true }).catch(() => null);
        } else {
          await interaction.reply({ content, ephemeral: true }).catch(() => null);
        }
      }

      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const guildState = playerService.getGuildState(interaction.guildId);
    logger.info('Chat input command received.', buildInteractionMeta(interaction, {
      currentTitle: guildState.current?.title || null,
      queueLength: guildState.tracks.length,
    }));

    try {
      if (interaction.commandName === 'play') {
        await interaction.deferReply();
        await playerService.ensureConnection(interaction, guildState);
        let sub = interaction.options.getSubcommand(false);
        const legacyInput = interaction.options.getString('url', false) || interaction.options.getString('input', false);
        if (!sub && legacyInput) {
          sub = 'url';
        }

        logger.info('Handling /play command.', buildInteractionMeta(interaction, {
          resolvedSubcommand: sub,
          legacyInput: legacyInput || null,
        }));

        if (sub === 'myplaylist') {
          const name = interaction.options.getString('name', true);
          const infinite = interaction.options.getBoolean('infinite') || false;
          const playlist = playlistStore.getPlaylistByName(interaction.user.id, name);
          if (!playlist) throw new Error('Khong tim thay playlist cua ban.');
          if (playlist.tracks.length === 0) throw new Error('Playlist dang trong.');

          logger.info('Queueing saved playlist from /play myplaylist.', buildInteractionMeta(interaction, {
            playlistName: playlist.name,
            trackCount: playlist.tracks.length,
            infinite,
          }));

          playerService.enqueuePlaylistToGuildWithOptions(guildState, playlist, interaction.user.username, { shuffle: false });
          playerService.configurePlaylistLoop(guildState, playlist, interaction.user.username, { infinite, shuffle: false });

          if (!guildState.current) {
            await playerService.playNext(interaction, guildState);
          } else {
            await panelService.upsertNowPlayingPanel(guildState);
          }

          await interaction.followUp({
            content: `Da nap playlist **${playlist.name}** (${playlist.tracks.length} bai). Infinite: **${infinite ? 'ON' : 'OFF'}**.`,
          });
          return;
        }

        if (sub === 'playlist') {
          const inputUrl = interaction.options.getString('url', true);
          const infinite = interaction.options.getBoolean('infinite') || false;
          logger.info('Resolving YouTube playlist for /play playlist.', buildInteractionMeta(interaction, {
            inputUrl,
            infinite,
          }));
          const ytPlaylist = await youtubeService.fetchYoutubePlaylistTracks(inputUrl);
          if (!ytPlaylist || ytPlaylist.tracks.length === 0) {
            throw new Error('Playlist YouTube khong co bai hop le de phat.');
          }

          const virtualPlaylist = {
            name: ytPlaylist.title || 'YouTube Playlist',
            tracks: ytPlaylist.tracks,
          };

          playerService.enqueuePlaylistToGuildWithOptions(guildState, virtualPlaylist, interaction.user.username, { shuffle: false });
          playerService.configurePlaylistLoop(guildState, virtualPlaylist, interaction.user.username, { infinite, shuffle: false });

          if (!guildState.current) {
            await playerService.playNext(interaction, guildState);
          } else {
            await panelService.upsertNowPlayingPanel(guildState);
          }

          await interaction.followUp({
            content: `Da nap YouTube playlist **${virtualPlaylist.name}** (${virtualPlaylist.tracks.length} bai). Infinite: **${infinite ? 'ON' : 'OFF'}**.${ytPlaylist.notice ? `\nLuu y: ${ytPlaylist.notice}` : ''}`,
          });
          return;
        }

        let queued;
        if (sub === 'url') {
          const rawUrl = interaction.options.getString('input', false) || legacyInput;
          if (!rawUrl) throw new Error('Thieu URL dau vao cho /play.');
          logger.info('Resolving /play url input.', buildInteractionMeta(interaction, { rawUrl }));
          const url = youtubeService.normalizePlayableUrl(rawUrl);
          const meta = await youtubeService.getVideoMetadata(url);
          queued = {
            url,
            title: meta.title,
            durationSec: meta.durationSec,
            thumbnail: meta.thumbnail,
            requestedBy: interaction.user.username,
          };
        } else if (sub === 'search') {
          const query = interaction.options.getString('input', true);
          logger.info('Resolving /play search input.', buildInteractionMeta(interaction, { query }));
          const found = await youtubeService.searchYoutubeVideo(query);
          queued = {
            url: found.url,
            title: found.title,
            durationSec: found.durationSec,
            thumbnail: found.thumbnail,
            requestedBy: interaction.user.username,
          };
        } else {
          throw new Error('Lenh /play chua duoc dong bo. Hay reload Discord (Ctrl+R) va dung /play url, /play search, hoac /play myplaylist.');
        }

        guildState.tracks.push(queued);
        logger.info('Track queued successfully.', buildInteractionMeta(interaction, {
          queuedTitle: queued.title,
          queuedUrl: queued.url,
          queueLength: guildState.tracks.length,
        }));

        if (!guildState.current) {
          await playerService.playNext(interaction, guildState);
        } else {
          await panelService.upsertNowPlayingPanel(guildState);
        }

        await interaction.followUp({ content: `Da them vao hang cho: ${queued.title}` });
        return;
      }

      if (interaction.commandName === 'skip') {
        logger.info('Handling /skip command.', buildInteractionMeta(interaction));
        if (!guildState.current) {
          await interaction.reply({ content: 'Khong co bai nao dang phat.', ephemeral: true });
          return;
        }
        guildState.player.stop();
        await interaction.reply('Da skip bai hien tai.');
        return;
      }

      if (interaction.commandName === 'stop') {
        logger.info('Handling /stop command.', buildInteractionMeta(interaction));
        playerService.clearAndDisconnect(guildState);
        await panelService.upsertNowPlayingPanel(guildState);
        await interaction.reply('Da dung nhac va xoa hang cho.');
        return;
      }

      if (interaction.commandName === 'kill') {
        logger.info('Handling /kill command.', buildInteractionMeta(interaction));
        playerService.clearAndDisconnect(guildState);
        await panelService.upsertNowPlayingPanel(guildState);
        await interaction.reply('Da huy phat nhac va roi voice channel ngay lap tuc.');
        return;
      }

      if (interaction.commandName === 'queue') {
        logger.info('Handling /queue command.', buildInteractionMeta(interaction, { queueLength: guildState.tracks.length }));
        await interaction.reply({ embeds: [buildQueueEmbed(guildState)] });
        return;
      }

      if (interaction.commandName === 'present') {
        logger.info('Handling /present command.', buildInteractionMeta(interaction));
        guildState.panelMessageId = null;
        guildState.panelChannelId = null;
        await panelService.upsertNowPlayingPanel(guildState, interaction.channelId);
        await interaction.reply({ content: 'Da hien thi lai UI Now Playing.', ephemeral: true });
        return;
      }

      if (interaction.commandName === 'leave') {
        logger.info('Handling /leave command.', buildInteractionMeta(interaction));
        playerService.clearAndDisconnect(guildState);
        await panelService.upsertNowPlayingPanel(guildState);
        await interaction.reply('Da roi voice channel.');
        return;
      }

      if (interaction.commandName === 'createplaylist' || interaction.commandName === 'cpl') {
        logger.info('Handling create playlist command family.', buildInteractionMeta(interaction));
        await handleCreatePlaylistCommands(interaction);
        return;
      }

      if (interaction.commandName === 'myplaylist' || interaction.commandName === 'mpl') {
        logger.info('Handling myplaylist command family.', buildInteractionMeta(interaction));
        await handleMyPlaylistCommands(interaction, guildState);
        return;
      }

      if (interaction.commandName === 'ringo') {
        logger.info('Handling /ringo command.', buildInteractionMeta(interaction));
        await interaction.reply({ embeds: [buildRingoHelpEmbed()], ephemeral: true });
      }
    } catch (error) {
      logger.error('Chat input command failed.', buildInteractionMeta(interaction, { error }));
      const message = `Loi: ${error.message || 'khong ro nguyen nhan'}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true }).catch(() => null);
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => null);
      }
    }
  }

  return {
    handle,
  };
}

module.exports = {
  createInteractionHandler,
};
