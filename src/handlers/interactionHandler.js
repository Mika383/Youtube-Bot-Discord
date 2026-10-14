const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const { formatDuration, truncateText } = require('../utils/format');
const { createLogger } = require('../utils/logger');
const {
  BTN_INFINITE,
  BTN_PAUSE_RESUME,
  BTN_PREVIOUS,
  BTN_QUEUE,
  BTN_SHUFFLE,
  BTN_SHUFFLE_INFINITE,
  BTN_SKIP,
  BTN_STOP,
} = require('../services/nowPlayingPanel');

const logger = createLogger('interaction');

function buildRingoHelpEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('/ringo - Hướng dẫn lệnh bot')
    .setDescription('Danh sách toàn bộ lệnh hiện có và cách dùng nhanh.')
    .addFields(
      {
        name: 'Phát nhạc',
        value: [
          '`/play input:<tên hoặc URL> [infinite]`: Tự động tìm bài, phát video hoặc playlist YouTube.',
          '`/playlist`: Mở bảng quản lý và phát playlist cá nhân.',
          '`/skip`: Bỏ qua bài hiện tại.',
          '`/shuffle`: Bật hoặc tắt chế độ trộn bài.',
          '`/stop`: Dừng phát, xóa hàng chờ và rời kênh thoại.',
          '`/kill`: Hủy phiên phát và rời kênh thoại ngay lập tức.',
          '`/queue`: Xem hàng chờ hiện tại.',
          '`/leave`: Cho bot rời kênh thoại.',
          '`/present`: Hiển thị lại bảng điều khiển đang phát.',
        ].join('\n'),
      },
      {
        name: 'Playlist cá nhân',
        value: [
          '`/playlist`: Mở bảng quản lý riêng tư.',
          'Tạo, đổi tên, nhập YouTube và thêm URL bằng biểu mẫu.',
          'Phát, lặp vô hạn, xóa bài và lưu hàng chờ ngay trên bảng.',
        ].join('\n'),
      },
      {
        name: 'Lưu ý về quyền sở hữu',
        value: 'Playlist gắn với tài khoản Discord. Người khác không thể sửa hoặc xóa playlist của bạn.',
      },
    )
    .setFooter({ text: 'Mẹo: Dùng /playlist để quản lý toàn bộ playlist cá nhân.' })
    .setTimestamp(new Date());
}

function buildQueueEmbed(guildState, page = 1) {
  const pageSize = 10;
  const totalTracks = guildState.tracks.length;
  const totalPages = Math.ceil(totalTracks / pageSize) || 1;
  const currentPage = Math.max(1, Math.min(page, totalPages));

  const embed = new EmbedBuilder()
    .setColor(0x1f6feb)
    .setTitle('📜 Hàng chờ')
    .setTimestamp(new Date());

  if (!guildState.current && totalTracks === 0) {
    embed.setDescription('Hàng chờ đang trống.');
    return { embed, totalPages: 1, currentPage: 1 };
  }

  if (guildState.current) {
    embed.addFields({
      name: '🎧 Đang phát',
      value: `${truncateText(guildState.current.title, 900)}${guildState.current.durationSec ? ` (${formatDuration(guildState.current.durationSec)})` : ''}`,
    });
  }

  if (totalTracks > 0) {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const list = guildState.tracks
      .slice(start, end)
      .map((t, i) => `${start + i + 1}. ${truncateText(t.title, 80)}${t.durationSec ? ` (${formatDuration(t.durationSec)})` : ''}`)
      .join('\n');
    
    embed.addFields({ name: `Tiếp theo (${totalTracks} bài)`, value: truncateText(list, 1024) });
    embed.setFooter({ text: `Trang ${currentPage}/${totalPages} • Tổng số ${totalTracks} bài` });
  }

  return { embed, totalPages, currentPage };
}

function buildQueueComponents(currentPage, totalPages) {
  if (totalPages <= 1) return [];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_prev_${currentPage - 1}`)
      .setLabel('Trang trước')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(`queue_next_${currentPage + 1}`)
      .setLabel('Trang sau')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages),
  );

  return [row];
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

  function hasPlayerPanelOrSession(guildState) {
    return Boolean(
      guildState
      && (
        guildState.panelMessageId
        || guildState.current
        || guildState.connection
        || guildState.tracks.length > 0
      )
    );
  }

  async function requirePlaylistPanelState(interaction, ownerId) {
    if (!ownerId || interaction.user.id !== ownerId) {
      await interaction.reply({ content: 'Đây không phải bảng quản lý playlist của bạn.', ephemeral: true });
      return null;
    }

    const messageId = interaction.message?.id || null;
    const state = messageId ? playlistPanelService.getState(messageId) : null;
    if (!state || state.ownerId !== ownerId) {
      await interaction.reply({
        content: 'Bảng quản lý này đã hết hạn. Hãy dùng `/playlist` để mở bảng mới.',
        ephemeral: true,
      });
      return null;
    }

    return state;
  }

  async function renderPlaylistPanel(interaction, ownerId, guildState, selectedKey, note = null, trackPage = 0) {
    const panel = playlistPanelService.buildPlaylistPanelPayload(
      ownerId,
      selectedKey,
      guildState,
      note,
      trackPage,
    );

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(panel.payload);
    } else if (interaction.isMessageComponent?.()
      || (interaction.isModalSubmit?.() && interaction.isFromMessage?.())) {
      await interaction.update(panel.payload);
    } else {
      await interaction.reply({ ...panel.payload, ephemeral: true });
    }

    let messageId = interaction.message?.id || null;
    if (!messageId) {
      const reply = await interaction.fetchReply().catch(() => null);
      messageId = reply?.id || null;
    }
    if (messageId) {
      playlistPanelService.setState(messageId, ownerId, panel.selectedKey, panel.trackPage);
    }
    return panel;
  }

  async function deferPlaylistModal(interaction) {
    if (interaction.isFromMessage?.()) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply({ ephemeral: true });
    }
  }

  async function handlePlaylistModal(interaction) {
    const [action, ownerId, customSelectedKey] = interaction.customId.split(':');
    const state = await requirePlaylistPanelState(interaction, ownerId);
    if (!state) return;

    const guildState = playerService.getGuildState(interaction.guildId);
    if (customSelectedKey && state.selectedKey !== customSelectedKey) {
      await interaction.reply({
        content: 'Playlist đã chọn đã thay đổi. Hãy mở lại thao tác từ bảng quản lý hiện tại.',
        ephemeral: true,
      });
      return;
    }

    await deferPlaylistModal(interaction);

    if (action === ids.PL_MODAL_CREATE) {
      const name = interaction.fields.getTextInputValue(ids.PL_INPUT_NAME);
      const created = playlistStore.createPlaylist(ownerId, name);
      logger.info('Playlist created from management panel.', buildInteractionMeta(interaction, {
        playlistName: created.name,
        playlistKey: created.key,
      }));
      await renderPlaylistPanel(interaction, ownerId, guildState, created.key, `Đã tạo playlist: ${created.name}`);
      return;
    }

    if (action === ids.PL_MODAL_RENAME) {
      const playlist = playlistStore.getPlaylistByKey(ownerId, customSelectedKey);
      if (!playlist) throw new Error('Playlist không còn tồn tại.');
      const newName = interaction.fields.getTextInputValue(ids.PL_INPUT_NAME);
      const oldName = playlist.name;
      const renamed = playlistStore.renamePlaylist(ownerId, playlist.name, newName);
      logger.info('Playlist renamed from management panel.', buildInteractionMeta(interaction, {
        oldName,
        newName: renamed.name,
      }));
      await renderPlaylistPanel(interaction, ownerId, guildState, renamed.key, `Đã đổi tên thành: ${renamed.name}`);
      return;
    }

    if (action === ids.PL_MODAL_IMPORT) {
      const name = interaction.fields.getTextInputValue(ids.PL_INPUT_NAME);
      const inputUrl = interaction.fields.getTextInputValue(ids.PL_INPUT_URL);
      if (playlistStore.getPlaylistByName(ownerId, name)) {
        throw new Error('Playlist đã tồn tại. Hãy dùng tên khác hoặc xóa playlist cũ.');
      }

      const imported = await youtubeService.fetchYoutubePlaylistTracks(inputUrl);
      const created = playlistStore.createPlaylist(ownerId, name);
      const cappedTracks = imported.tracks.slice(0, playlistStore.MAX_TRACKS_PER_PLAYLIST);
      playlistStore.addTracksToPlaylist(ownerId, created.key, cappedTracks);
      logger.info('YouTube playlist imported from management panel.', buildInteractionMeta(interaction, {
        playlistName: created.name,
        sourceTitle: imported.title,
        importedTrackCount: imported.tracks.length,
        storedTrackCount: cappedTracks.length,
      }));

      const limitNote = imported.tracks.length > cappedTracks.length
        ? `, giới hạn ${playlistStore.MAX_TRACKS_PER_PLAYLIST} bài`
        : '';
      const providerNote = imported.notice ? ` • ${imported.notice}` : '';
      await renderPlaylistPanel(
        interaction,
        ownerId,
        guildState,
        created.key,
        `Đã nhập ${cappedTracks.length} bài từ ${truncateText(imported.title, 150)}${limitNote}${providerNote}`,
      );
      return;
    }

    if (action === ids.PL_MODAL_ADD_URL) {
      const rawUrl = interaction.fields.getTextInputValue(ids.PL_INPUT_URL);
      const url = youtubeService.normalizePlayableUrl(rawUrl);
      const metadata = await youtubeService.getVideoMetadata(url);
      const playlist = playlistStore.addTrackToPlaylist(ownerId, customSelectedKey, {
        url,
        title: metadata.title,
        durationSec: metadata.durationSec,
        thumbnail: metadata.thumbnail,
      });
      logger.info('Track URL added from management panel.', buildInteractionMeta(interaction, {
        playlistName: playlist.name,
        trackTitle: metadata.title,
        trackUrl: url,
      }));
      await renderPlaylistPanel(
        interaction,
        ownerId,
        guildState,
        playlist.key,
        `Đã thêm: ${truncateText(metadata.title, 300)}`,
        state.trackPage,
      );
      return;
    }

    throw new Error('Biểu mẫu playlist không hợp lệ.');
  }

  async function handleCore(interaction) {
    logger.info('Interaction received.', buildInteractionMeta(interaction));

    if (interaction.isModalSubmit() && interaction.customId.startsWith('pl_modal_')) {
      try {
        await handlePlaylistModal(interaction);
      } catch (error) {
        logger.error('Playlist modal interaction failed.', buildInteractionMeta(interaction, { error }));
        const content = `Lỗi: ${error.message || 'không rõ nguyên nhân'}`;
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content, ephemeral: true }).catch(() => null);
        } else {
          await interaction.reply({ content, ephemeral: true }).catch(() => null);
        }
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${ids.PL_SELECT}:`)) {
      const ownerId = interaction.customId.split(':')[1];
      const state = await requirePlaylistPanelState(interaction, ownerId);
      if (!state) return;

      const guildState = playerService.getGuildState(interaction.guildId);
      const selectedKey = interaction.values[0];
      if (!playlistStore.getPlaylistByKey(ownerId, selectedKey)) {
        await interaction.reply({ content: 'Playlist đã chọn không còn tồn tại.', ephemeral: true });
        return;
      }
      logger.info('Playlist select menu changed.', buildInteractionMeta(interaction, { selectedKey }));
      await renderPlaylistPanel(interaction, ownerId, guildState, selectedKey);
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${ids.PL_TRACK_REMOVE_SELECT}:`)) {
      const ownerId = interaction.customId.split(':')[1];
      const state = await requirePlaylistPanelState(interaction, ownerId);
      if (!state) return;

      const guildState = playerService.getGuildState(interaction.guildId);
      const selectedKey = state.selectedKey;
      if (!selectedKey) {
        await interaction.reply({ content: 'Bạn chưa có playlist để thao tác.', ephemeral: true });
        return;
      }

      const index = Number(interaction.values[0]);
      logger.info('Playlist remove-track menu used.', buildInteractionMeta(interaction, { selectedKey, index }));
      try {
        const removed = playlistStore.removeTrackByIndex(ownerId, selectedKey, index);
        await renderPlaylistPanel(
          interaction,
          ownerId,
          guildState,
          selectedKey,
          `Đã xóa: ${removed.title}`,
          state.trackPage,
        );
      } catch (error) {
        logger.error('Playlist remove-track interaction failed.', buildInteractionMeta(interaction, { error }));
        await interaction.reply({
          content: `Lỗi: ${error.message || 'không rõ nguyên nhân'}`,
          ephemeral: true,
        }).catch(() => null);
      }
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
          const { embed, totalPages, currentPage } = buildQueueEmbed(guildState);
          await interaction.reply({
            embeds: [embed],
            components: buildQueueComponents(currentPage, totalPages),
            ephemeral: true,
          });
          return;
        }

        const isPlaybackControl = interaction.customId === BTN_PAUSE_RESUME
          || interaction.customId === BTN_PREVIOUS
          || interaction.customId === BTN_SKIP
          || interaction.customId === BTN_INFINITE
          || interaction.customId === BTN_SHUFFLE
          || interaction.customId === BTN_SHUFFLE_INFINITE
          || interaction.customId === BTN_STOP;

        if (isPlaybackControl
          && guildState.panelMessageId
          && interaction.message.id !== guildState.panelMessageId) {
          await interaction.reply({
            content: 'Bảng điều khiển này đã cũ. Hãy dùng bảng mới nhất hoặc `/present`.',
            ephemeral: true,
          });
          return;
        }

        if (interaction.customId === BTN_SHUFFLE_INFINITE) {
          await interaction.reply({
            content: 'Nút này đã được thay thế. Hãy dùng riêng `🔀` và `🔁` trên bảng điều khiển mới.',
            ephemeral: true,
          });
          return;
        }

        if (isPlaybackControl) {
          playerService.requireSameVoiceChannel(interaction, guildState);
        }

        if (interaction.customId === BTN_PAUSE_RESUME) {
          if (!guildState.current) {
            await interaction.reply({ content: 'Không có bài nào đang phát.', ephemeral: true });
            return;
          }

          if (guildState.isPaused) {
            guildState.player.unpause();
            guildState.isPaused = false;
            guildState.currentStartedAtMs = Date.now() - guildState.pausedElapsedMs;
            await interaction.reply({ content: 'Đã tiếp tục phát.', ephemeral: true });
          } else {
            guildState.player.pause(true);
            guildState.isPaused = true;
            guildState.pausedElapsedMs = Math.max(0, Date.now() - guildState.currentStartedAtMs);
            await interaction.reply({ content: 'Đã tạm dừng.', ephemeral: true });
          }

          await panelService.upsertNowPlayingPanel(guildState);
          return;
        }

        if (interaction.customId === BTN_SKIP) {
          if (!guildState.current) {
            await interaction.reply({ content: 'Không có bài nào đang phát.', ephemeral: true });
            return;
          }
          guildState.player.stop();
          await interaction.reply({ content: 'Đã bỏ qua bài hiện tại.', ephemeral: true });
          return;
        }

        if (interaction.customId === BTN_PREVIOUS) {
          playerService.playPrevious(guildState);
          await interaction.reply({ content: 'Đã quay lại bài trước.', ephemeral: true });
          return;
        }

        if (interaction.customId === BTN_INFINITE) {
          const status = playerService.toggleInfiniteMode(guildState);
          await panelService.upsertNowPlayingPanel(guildState);
          await interaction.reply({ content: `Lặp vô hạn đã ${status ? 'BẬT' : 'TẮT'}.`, ephemeral: true });
          return;
        }

        if (interaction.customId === BTN_SHUFFLE) {
          const status = playerService.toggleShuffleMode(guildState);
          await panelService.upsertNowPlayingPanel(guildState);
          await interaction.reply({ content: `Trộn bài đã ${status ? 'BẬT' : 'TẮT'}.`, ephemeral: true });
          return;
        }

        if (interaction.customId === BTN_STOP) {
          playerService.clearAndDisconnect(guildState);
          await panelService.upsertNowPlayingPanel(guildState);
          await interaction.reply({ content: 'Đã dừng nhạc và xóa hàng chờ.', ephemeral: true });
          return;
        }

        if (interaction.customId.startsWith('queue_')) {
          const parts = interaction.customId.split('_');
          const page = parseInt(parts[2], 10);
          const { embed, totalPages, currentPage } = buildQueueEmbed(guildState, page);
          await interaction.update({
            embeds: [embed],
            components: buildQueueComponents(currentPage, totalPages),
          });
          return;
        }

        if (interaction.customId.startsWith('pl_')) {
          const [action, ownerId] = interaction.customId.split(':');
          const state = await requirePlaylistPanelState(interaction, ownerId);
          if (!state) return;
          const selectedKey = state.selectedKey;

          if (action === ids.PL_CREATE) {
            await interaction.showModal(playlistPanelService.buildCreateModal(ownerId));
            return;
          }

          if (action === ids.PL_IMPORT) {
            await interaction.showModal(playlistPanelService.buildImportModal(ownerId));
            return;
          }

          if (!selectedKey) {
            await interaction.reply({ content: 'Bạn chưa có playlist để thao tác.', ephemeral: true });
            return;
          }

          if (action === ids.PL_RENAME) {
            await interaction.showModal(playlistPanelService.buildRenameModal(ownerId, selectedKey));
            return;
          }

          if (action === ids.PL_ADD_URL) {
            await interaction.showModal(playlistPanelService.buildAddUrlModal(ownerId, selectedKey));
            return;
          }

          if (action === ids.PL_TRACK_PREV || action === ids.PL_TRACK_NEXT) {
            const nextPage = action === ids.PL_TRACK_PREV
              ? state.trackPage - 1
              : state.trackPage + 1;
            await renderPlaylistPanel(interaction, ownerId, guildState, selectedKey, null, nextPage);
            return;
          }

          if (action === ids.PL_DELETE) {
            await interaction.update(playlistPanelService.buildDeleteConfirmationPayload(ownerId, selectedKey));
            return;
          }

          if (action === ids.PL_DELETE_CANCEL) {
            await renderPlaylistPanel(
              interaction,
              ownerId,
              guildState,
              selectedKey,
              'Đã hủy thao tác xóa.',
              state.trackPage,
            );
            return;
          }

          if (action === ids.PL_DELETE_CONFIRM) {
            const playlist = playlistStore.getPlaylistByKey(ownerId, selectedKey);
            if (!playlist) throw new Error('Playlist không còn tồn tại.');
            playlistStore.deletePlaylist(ownerId, selectedKey);
            const fallback = playlistStore.listUserPlaylists(ownerId)[0]?.key || null;
            await renderPlaylistPanel(
              interaction,
              ownerId,
              guildState,
              fallback,
              `Đã xóa playlist: ${truncateText(playlist.name, 100)}`,
            );
            return;
          }

          if (action === ids.PL_SAVE_QUEUE) {
            const snapshot = getQueueSnapshot(guildState);
            if (snapshot.length === 0) throw new Error('Hàng chờ hiện tại đang trống.');
            await interaction.update(
              playlistPanelService.buildSaveQueueConfirmationPayload(ownerId, selectedKey, snapshot.length),
            );
            return;
          }

          if (action === ids.PL_SAVE_CANCEL) {
            await renderPlaylistPanel(
              interaction,
              ownerId,
              guildState,
              selectedKey,
              'Đã hủy thao tác lưu hàng chờ.',
              state.trackPage,
            );
            return;
          }

          if (action === ids.PL_SAVE_REPLACE || action === ids.PL_SAVE_APPEND) {
            const snapshot = getQueueSnapshot(guildState);
            if (snapshot.length === 0) throw new Error('Hàng chờ hiện tại đang trống.');
            const append = action === ids.PL_SAVE_APPEND;
            const updated = append
              ? playlistStore.addTracksToPlaylist(ownerId, selectedKey, snapshot)
              : playlistStore.replacePlaylistTracks(ownerId, selectedKey, snapshot);
            await renderPlaylistPanel(
              interaction,
              ownerId,
              guildState,
              updated.key,
              `Đã ${append ? 'nối thêm' : 'ghi đè'} ${snapshot.length} bài vào ${updated.name}.`,
              state.trackPage,
            );
            return;
          }

          if (action === ids.PL_PLAY || action === ids.PL_PLAY_INFINITE) {
            await interaction.deferUpdate();
            const playlist = playlistStore.getPlaylistByKey(ownerId, selectedKey);
            if (!playlist || playlist.tracks.length === 0) throw new Error('Playlist đang trống.');
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

            await renderPlaylistPanel(
              interaction,
              ownerId,
              guildState,
              selectedKey,
              `Đã nạp playlist ${playlist.name}. Lặp vô hạn: ${infinite ? 'BẬT' : 'TẮT'}.`,
              state.trackPage,
            );
            return;
          }

          if (action === ids.PL_ADD_CURRENT) {
            if (!guildState.current) throw new Error('Không có bài đang phát để thêm.');
            const updated = playlistStore.addTrackToPlaylist(ownerId, selectedKey, guildState.current);
            await renderPlaylistPanel(
              interaction,
              ownerId,
              guildState,
              updated.key,
              `Đã thêm: ${guildState.current.title}`,
              state.trackPage,
            );
            return;
          }

          throw new Error('Thao tác playlist không hợp lệ.');
        }
      } catch (error) {
        logger.error('Button interaction failed.', buildInteractionMeta(interaction, { error }));
        const content = `Lỗi: ${error.message || 'không rõ nguyên nhân'}`;
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
        const input = interaction.options.getString('input', true);
        const infinite = interaction.options.getBoolean('infinite') || false;
        const resolvedInput = youtubeService.classifyPlayInput(input);
        if (infinite && resolvedInput.type !== 'playlist') {
          throw new Error('Tùy chọn lặp vô hạn chỉ dùng cho URL playlist YouTube.');
        }

        // Voice negotiation and YouTube resolution are independent. Start both as
        // early as possible, while converting connection rejection into data so a
        // slower metadata request cannot create an unhandled rejection.
        const connectionResultPromise = playerService.ensureConnection(interaction, guildState).then(
          () => ({ ok: true }),
          (error) => ({ ok: false, error }),
        );
        const requireConnection = async () => {
          const result = await connectionResultPromise;
          if (!result.ok) throw result.error;
        };

        logger.info('Handling /play command.', buildInteractionMeta(interaction, {
          inputType: resolvedInput.type,
          infinite,
        }));

        if (resolvedInput.type === 'playlist') {
          logger.info('Resolving playlist from unified /play input.', buildInteractionMeta(interaction, {
            listId: resolvedInput.listId,
            infinite,
          }));
          const ytPlaylist = await youtubeService.fetchYoutubePlaylistTracks(resolvedInput.url);
          if (!ytPlaylist || ytPlaylist.tracks.length === 0) {
            throw new Error('Playlist YouTube không có bài hợp lệ để phát.');
          }

          const virtualPlaylist = {
            name: ytPlaylist.title || 'Playlist YouTube',
            tracks: ytPlaylist.tracks,
          };

          await requireConnection();
          playerService.enqueuePlaylistToGuildWithOptions(guildState, virtualPlaylist, interaction.user.username, { shuffle: false });
          playerService.configurePlaylistLoop(guildState, virtualPlaylist, interaction.user.username, { infinite, shuffle: false });

          if (!guildState.current) {
            await playerService.playNext(interaction, guildState);
          }

          await interaction.editReply({
            content: `Đã nạp YouTube playlist **${truncateText(virtualPlaylist.name, 100)}** (${virtualPlaylist.tracks.length} bài). Lặp vô hạn: **${infinite ? 'BẬT' : 'TẮT'}**.${ytPlaylist.notice ? `\nLưu ý: ${truncateText(ytPlaylist.notice, 500)}` : ''}`,
          });
          return;
        }

        let queued;
        if (resolvedInput.type === 'video') {
          logger.info('Resolving video from unified /play input.', buildInteractionMeta(interaction));
          const meta = await youtubeService.getVideoMetadata(resolvedInput.url);
          queued = {
            url: resolvedInput.url,
            title: meta.title,
            durationSec: meta.durationSec,
            thumbnail: meta.thumbnail,
            requestedBy: interaction.user.username,
          };
        } else {
          logger.info('Resolving search from unified /play input.', buildInteractionMeta(interaction, {
            query: resolvedInput.query,
          }));
          const found = await youtubeService.searchYoutubeVideo(resolvedInput.query);
          queued = {
            url: found.url,
            title: found.title,
            durationSec: found.durationSec,
            thumbnail: found.thumbnail,
            requestedBy: interaction.user.username,
          };
        }

        await requireConnection();
        playerService.enqueueTrack(guildState, queued);
        logger.info('Track queued successfully.', buildInteractionMeta(interaction, {
          queuedTitle: queued.title,
          queuedUrl: queued.url,
          queueLength: guildState.tracks.length,
        }));

        if (!guildState.current) {
          await playerService.playNext(interaction, guildState);
        }

        await interaction.editReply({ content: `Đã thêm vào hàng chờ: ${truncateText(queued.title, 300)}` });
        return;
      }

      if (interaction.commandName === 'skip') {
        logger.info('Handling /skip command.', buildInteractionMeta(interaction));
        playerService.requireSameVoiceChannel(interaction, guildState);
        if (!guildState.current) {
          await interaction.reply({ content: 'Không có bài nào đang phát.', ephemeral: true });
          return;
        }
        guildState.player.stop();
        await interaction.reply('Đã bỏ qua bài hiện tại.');
        return;
      }

      if (interaction.commandName === 'stop') {
        logger.info('Handling /stop command.', buildInteractionMeta(interaction));
        playerService.requireSameVoiceChannel(interaction, guildState);
        playerService.clearAndDisconnect(guildState);
        await panelService.upsertNowPlayingPanel(guildState);
        await interaction.reply('Đã dừng nhạc và xóa hàng chờ.');
        return;
      }

      if (interaction.commandName === 'kill') {
        logger.info('Handling /kill command.', buildInteractionMeta(interaction));
        playerService.requireSameVoiceChannel(interaction, guildState);
        playerService.clearAndDisconnect(guildState);
        await panelService.upsertNowPlayingPanel(guildState);
        await interaction.reply('Đã hủy phát nhạc và rời kênh thoại ngay lập tức.');
        return;
      }

      if (interaction.commandName === 'queue') {
        logger.info('Handling /queue command.', buildInteractionMeta(interaction, { queueLength: guildState.tracks.length }));
        const { embed, totalPages, currentPage } = buildQueueEmbed(guildState, 1);
        await interaction.reply({
          embeds: [embed],
          components: buildQueueComponents(currentPage, totalPages),
        });
        return;
      }

      if (interaction.commandName === 'shuffle') {
        logger.info('Handling /shuffle command.', buildInteractionMeta(interaction));
        playerService.requireSameVoiceChannel(interaction, guildState);
        const status = playerService.toggleShuffleMode(guildState);
        await panelService.upsertNowPlayingPanel(guildState);
        await interaction.reply(`Trộn bài đã ${status ? 'BẬT' : 'TẮT'}.`);
        return;
      }

      if (interaction.commandName === 'present') {
        logger.info('Handling /present command.', buildInteractionMeta(interaction));
        if (!hasPlayerPanelOrSession(guildState)) {
          throw new Error('Chưa có trình phát để đưa xuống vị trí mới nhất.');
        }
        await interaction.deferReply({ ephemeral: true });
        await interaction.editReply({ content: 'Đã đưa bảng điều khiển xuống vị trí mới nhất.' });
        return;
      }

      if (interaction.commandName === 'leave') {
        logger.info('Handling /leave command.', buildInteractionMeta(interaction));
        playerService.requireSameVoiceChannel(interaction, guildState);
        playerService.clearAndDisconnect(guildState);
        await panelService.upsertNowPlayingPanel(guildState);
        await interaction.reply('Đã rời kênh thoại.');
        return;
      }

      if (interaction.commandName === 'playlist') {
        const panel = playlistPanelService.buildPlaylistPanelPayload(interaction.user.id, null, guildState);
        logger.info('Opening unified playlist management panel.', buildInteractionMeta(interaction, {
          selectedKey: panel.selectedKey,
        }));
        await interaction.reply({ ...panel.payload, ephemeral: true });
        const reply = await interaction.fetchReply();
        playlistPanelService.setState(reply.id, interaction.user.id, panel.selectedKey, panel.trackPage);
        return;
      }

      if (interaction.commandName === 'ringo') {
        logger.info('Handling /ringo command.', buildInteractionMeta(interaction));
        await interaction.reply({ embeds: [buildRingoHelpEmbed()], ephemeral: true });
      }
    } catch (error) {
      logger.error('Chat input command failed.', buildInteractionMeta(interaction, { error }));
      const message = `Lỗi: ${error.message || 'không rõ nguyên nhân'}`;
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: message }).catch(() => null);
      } else if (interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true }).catch(() => null);
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => null);
      }
    }
  }

  async function relocatePlayerAfterResponse(interaction) {
    if (!interaction?.guildId || (!interaction.replied && !interaction.deferred)) return;

    const guildState = playerService.queue.get(interaction.guildId);
    if (!hasPlayerPanelOrSession(guildState)) return;

    await panelService.relocateNowPlayingPanel(guildState, interaction.channelId);
  }

  async function handle(interaction) {
    try {
      await handleCore(interaction);
    } finally {
      await relocatePlayerAfterResponse(interaction).catch((error) => {
        logger.error('Failed to relocate player panel after interaction response.', buildInteractionMeta(interaction, {
          error,
        }));
      });
    }
  }

  return {
    handle,
  };
}

module.exports = {
  createInteractionHandler,
};
