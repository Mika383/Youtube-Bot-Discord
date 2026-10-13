const {
  joinVoiceChannel,
  createAudioPlayer,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  entersState,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const { createLogger } = require('../utils/logger');

const logger = createLogger('player');

function createPlayerService({ youtubeService, panelService, client }) {
  const queue = new Map();

  function buildGuildMeta(guildState, extra = {}) {
    return {
      guildId: guildState?.guildId || null,
      currentTitle: guildState?.current?.title || null,
      currentUrl: guildState?.current?.url || null,
      queueLength: guildState?.tracks?.length || 0,
      historyLength: guildState?.history?.length || 0,
      isPaused: Boolean(guildState?.isPaused),
      voiceChannelId: guildState?.connection?.joinConfig?.channelId || null,
      textChannelId: guildState?.textChannelId || null,
      ...extra,
    };
  }

  function shuffleArray(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function mapTrackForQueue(track, requestedBy) {
    return {
      url: track.url,
      title: track.title,
      durationSec: track.durationSec || 0,
      thumbnail: track.thumbnail || null,
      requestedBy,
    };
  }

  function getGuildState(guildId) {
    if (!queue.has(guildId)) {
      const guildState = {
        guildId,
        tracks: [],
        player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }),
        connection: null,
        current: null,
        textChannelId: null,
        panelMessageId: null,
        panelChannelId: null,
        isPaused: false,
        currentStartedAtMs: 0,
        pausedElapsedMs: 0,
        history: [],
        queueInfiniteMode: false,
        queueInfiniteTemplate: null,
        shuffleMode: false,
        playlistLoopTemplate: null,
        playlistLoopRequestedBy: null,
        idleTimer: null,
        emptyVoiceTimer: null,
        activeResourceCleanup: null,
        connectionPromise: null,
        connectionRecoveryPromise: null,
      };

      logger.info('Created guild player state.', buildGuildMeta(guildState));

      guildState.player.on(AudioPlayerStatus.Playing, () => {
        logger.info('Audio player entered Playing state.', buildGuildMeta(guildState));
        panelService.upsertNowPlayingPanel(guildState).catch((error) => {
          logger.error('Failed to update now playing panel while entering Playing.', {
            ...buildGuildMeta(guildState),
            error,
          });
        });
      });

      guildState.player.on(AudioPlayerStatus.Idle, () => {
        logger.info('Audio player entered Idle state.', buildGuildMeta(guildState));
        releaseActiveResource(guildState);
        if (guildState.tracks.length === 0 && !guildState.queueInfiniteMode && !guildState.playlistLoopTemplate?.length) {
          logger.info('Queue is empty. Starting 30s idle timer.', buildGuildMeta(guildState));
          guildState.idleTimer = setTimeout(() => {
            logger.info('Idle timer reached. Disconnecting.', buildGuildMeta(guildState));
            clearAndDisconnect(guildState);
            panelService.upsertNowPlayingPanel(guildState).catch((error) => {
              logger.error('Failed to update now playing panel after idle timeout.', {
                ...buildGuildMeta(guildState),
                error,
              });
            });
          }, 30 * 1000);
        }
        playNext(null, guildState).catch((error) => {
          logger.error('Failed to advance queue after Idle.', {
            ...buildGuildMeta(guildState),
            error,
          });
        });
      });

      guildState.player.on('error', (error) => {
        logger.error('Audio player emitted an error.', {
          ...buildGuildMeta(guildState),
          error,
        });
        releaseActiveResource(guildState);
        playNext(null, guildState).catch((playNextError) => {
          logger.error('Failed to advance queue after audio player error.', {
            ...buildGuildMeta(guildState),
            error: playNextError,
          });
        });
      });

      queue.set(guildId, guildState);
    }
    return queue.get(guildId);
  }

  function releaseActiveResource(guildState) {
    const cleanup = guildState.activeResourceCleanup;
    guildState.activeResourceCleanup = null;
    if (typeof cleanup !== 'function') return;

    try {
      cleanup();
    } catch (error) {
      logger.warn('Failed to clean up active audio resource.', {
        ...buildGuildMeta(guildState),
        error,
      });
    }
  }

  async function sendTextNotice(guildState, content) {
    if (!client || !guildState.textChannelId) return;
    const guild = client.guilds.cache.get(guildState.guildId);
    if (!guild) return;
    const cached = guild.channels.cache.get(guildState.textChannelId);
    const channel = cached || await guild.channels.fetch(guildState.textChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    await channel.send({ content, allowedMentions: { parse: [] } }).catch((error) => {
      logger.warn('Failed to send player notice.', { ...buildGuildMeta(guildState), error });
    });
  }

  async function playNext(interaction, guildState) {
    let lastStreamError = null;
    let failedTrackCount = 0;
    logger.info('Attempting to play next track.', buildGuildMeta(guildState, {
      triggeredByUserId: interaction?.user?.id || null,
      triggeredByCommand: interaction?.commandName || null,
    }));

    if (guildState.tracks.length === 0 && guildState.queueInfiniteMode && guildState.queueInfiniteTemplate?.length) {
      logger.info('Rehydrating queue from infinite queue template.', buildGuildMeta(guildState, {
        templateLength: guildState.queueInfiniteTemplate.length,
        shuffleMode: guildState.shuffleMode,
      }));
      const template = guildState.shuffleMode
        ? shuffleArray([...guildState.queueInfiniteTemplate])
        : guildState.queueInfiniteTemplate;
      guildState.tracks.push(
        ...template.map((track) => mapTrackForQueue(track, track.requestedBy || 'Infinite Queue')),
      );
    }

    if (guildState.tracks.length === 0 && guildState.playlistLoopTemplate?.length) {
      logger.info('Rehydrating queue from playlist loop template.', buildGuildMeta(guildState, {
        templateLength: guildState.playlistLoopTemplate.length,
        shuffle: guildState.shuffleMode,
      }));
      const loopTracks = guildState.shuffleMode
        ? shuffleArray([...guildState.playlistLoopTemplate])
        : [...guildState.playlistLoopTemplate];
      guildState.tracks.push(
        ...loopTracks.map((track) => mapTrackForQueue(track, guildState.playlistLoopRequestedBy || 'Playlist Loop')),
      );
    }

    while (guildState.tracks.length > 0) {
      const next = guildState.tracks.shift();
      if (!next?.url) continue;

      logger.info('Selected next track from queue.', buildGuildMeta(guildState, {
        nextTitle: next.title,
        nextUrl: next.url,
        requestedBy: next.requestedBy || null,
        remainingQueueLength: guildState.tracks.length,
      }));

      if (guildState.current) {
        guildState.history.push(guildState.current);
        if (guildState.history.length > 100) guildState.history.shift();
      }

      guildState.current = next;
      guildState.isPaused = false;
      guildState.currentStartedAtMs = Date.now();
      guildState.pausedElapsedMs = 0;

      if (guildState.idleTimer) {
        clearTimeout(guildState.idleTimer);
        guildState.idleTimer = null;
      }

      try {
        const resource = await youtubeService.createYoutubeAudioResource(next.url);
        logger.info('Audio resource created successfully.', buildGuildMeta(guildState, {
          nextTitle: next.title,
          nextUrl: next.url,
        }));
        releaseActiveResource(guildState);
        guildState.activeResourceCleanup = resource.metadata?.cleanup || null;
        guildState.player.play(resource);
        logger.info('Audio player.play invoked.', buildGuildMeta(guildState, {
          nextTitle: next.title,
          nextUrl: next.url,
          provider: resource.metadata?.provider || 'unknown',
        }));
        return;
      } catch (streamError) {
        releaseActiveResource(guildState);
        guildState.current = null;
        guildState.isPaused = false;
        guildState.currentStartedAtMs = 0;
        guildState.pausedElapsedMs = 0;
        lastStreamError = streamError;
        failedTrackCount += 1;
        logger.error('Skipping track due to stream creation/playback error.', {
          ...buildGuildMeta(guildState, {
            failedTitle: next.title,
            failedUrl: next.url,
          }),
          error: streamError,
        });
      }
    }

    guildState.current = null;
    guildState.isPaused = false;
    guildState.currentStartedAtMs = 0;
    guildState.pausedElapsedMs = 0;
    logger.info('Queue exhausted; player state reset.', buildGuildMeta(guildState));
    await panelService.upsertNowPlayingPanel(guildState).catch((error) => {
      logger.error('Failed to update now playing panel after queue exhaustion.', {
        ...buildGuildMeta(guildState),
        error,
      });
      return null;
    });

    if (lastStreamError) {
      const playbackError = new Error(
        failedTrackCount > 1
          ? `Khong the phat ${failedTrackCount} bai trong hang cho luc nay.`
          : 'Khong the phat bai nay luc nay. Vui long thu lai sau.',
      );
      playbackError.code = 'PLAYBACK_UNAVAILABLE';
      playbackError.cause = lastStreamError;
      throw playbackError;
    }
  }

  function snapshotQueueForInfinite(guildState) {
    const snapshot = [];
    if (guildState.current) snapshot.push(guildState.current);
    if (guildState.tracks.length > 0) snapshot.push(...guildState.tracks);
    return snapshot.map((track) => ({
      url: track.url,
      title: track.title,
      durationSec: track.durationSec || 0,
      thumbnail: track.thumbnail || null,
      requestedBy: track.requestedBy || 'Infinite Queue',
    }));
  }

  function toggleInfiniteMode(guildState) {
    const enabled = Boolean(guildState.queueInfiniteMode || guildState.playlistLoopTemplate?.length);
    if (enabled) {
      guildState.queueInfiniteMode = false;
      guildState.queueInfiniteTemplate = null;
      guildState.playlistLoopTemplate = null;
      guildState.playlistLoopRequestedBy = null;
      logger.info('Infinite queue mode disabled.', buildGuildMeta(guildState));
      return false;
    }

    const snapshot = snapshotQueueForInfinite(guildState);
    if (snapshot.length === 0) {
      throw new Error('Khong co bai de bat che do infinite.');
    }

    guildState.queueInfiniteMode = true;
    guildState.queueInfiniteTemplate = snapshot;
    guildState.playlistLoopTemplate = null;
    guildState.playlistLoopRequestedBy = null;
    logger.info('Infinite queue mode enabled.', buildGuildMeta(guildState, {
      snapshotLength: snapshot.length,
    }));
    return true;
  }
  
  function toggleShuffleMode(guildState) {
    if (guildState.shuffleMode) {
      guildState.shuffleMode = false;
      logger.info('Shuffle mode disabled.', buildGuildMeta(guildState));
      return false;
    }

    if (!guildState.current && guildState.tracks.length === 0) {
      throw new Error('Không có bài để bật Shuffle.');
    }

    guildState.shuffleMode = true;
    if (guildState.tracks.length > 0) {
      guildState.tracks = shuffleArray([...guildState.tracks]);
    }

    logger.info('Shuffle mode enabled.', buildGuildMeta(guildState));
    return true;
  }

  function playPrevious(guildState) {
    if (!guildState.history || guildState.history.length === 0) {
      throw new Error('Khong co bai truoc do.');
    }

    const previous = guildState.history.pop();
    if (guildState.current) {
      guildState.tracks.unshift(guildState.current);
    }
    guildState.tracks.unshift(previous);
    logger.info('Returning to previous track.', buildGuildMeta(guildState, {
      previousTitle: previous.title,
      previousUrl: previous.url,
    }));
    guildState.player.stop();
  }

  async function ensureConnection(interaction, guildState) {
    const memberChannel = interaction.member?.voice?.channel;
    if (!memberChannel) {
      logger.warn('ensureConnection failed because user is not in a voice channel.', buildGuildMeta(guildState, {
        userId: interaction.user?.id || null,
        guildId: interaction.guild?.id || guildState.guildId,
      }));
      throw new Error('Ban phai vao voice channel truoc da.');
    }

    const connectedChannelId = guildState.connection?.joinConfig?.channelId || null;
    if (connectedChannelId && connectedChannelId !== memberChannel.id) {
      throw new Error('Bạn phải vào cùng voice channel với bot để điều khiển phát nhạc.');
    }

    if (guildState.connection?.state?.status === VoiceConnectionStatus.Destroyed) {
      guildState.connection = null;
    }

    if (guildState.connectionPromise) {
      await guildState.connectionPromise;
    } else if (!guildState.connection) {
      if (!guildState.connectionPromise) {
        guildState.connectionPromise = (async () => {
          logger.info('Joining voice channel.', buildGuildMeta(guildState, {
            userId: interaction.user?.id || null,
            memberVoiceChannelId: memberChannel.id,
            memberVoiceChannelName: memberChannel.name,
          }));

          const connection = joinVoiceChannel({
            channelId: memberChannel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
            selfDeaf: true,
          });
          guildState.connection = connection;

          connection.on('stateChange', (oldState, newState) => {
            logger.debug('Voice connection state changed.', buildGuildMeta(guildState, {
              oldStatus: oldState.status,
              newStatus: newState.status,
            }));

            if (newState.status === VoiceConnectionStatus.Destroyed && guildState.connection === connection) {
              guildState.connection = null;
            }

            if (newState.status === VoiceConnectionStatus.Disconnected) {
              if (guildState.connectionRecoveryPromise) return;
              guildState.connectionRecoveryPromise = Promise.race([
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                entersState(connection, VoiceConnectionStatus.Ready, 5_000),
              ]).catch(async (error) => {
                logger.warn('Voice connection could not recover after disconnect.', {
                  ...buildGuildMeta(guildState),
                  error,
                });
                if (guildState.connection === connection) {
                  clearAndDisconnect(guildState);
                  await panelService.upsertNowPlayingPanel(guildState).catch(() => null);
                  await sendTextNotice(
                    guildState,
                    '⚠️ Kết nối voice đã bị gián đoạn và không thể khôi phục. Phiên phát đã được dừng.',
                  );
                }
              }).finally(() => {
                guildState.connectionRecoveryPromise = null;
              });
            }
          });

          try {
            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
          } catch (error) {
            if (guildState.connection === connection) guildState.connection = null;
            if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
            throw error;
          }

          connection.subscribe(guildState.player);
          logger.info('Voice connection is ready and subscribed to player.', buildGuildMeta(guildState, {
            memberVoiceChannelId: memberChannel.id,
            memberVoiceChannelName: memberChannel.name,
          }));
        })().finally(() => {
          guildState.connectionPromise = null;
        });
      }

      await guildState.connectionPromise;
    } else {
      logger.debug('Reusing existing voice connection.', buildGuildMeta(guildState, {
        userId: interaction.user?.id || null,
        memberVoiceChannelId: memberChannel.id,
      }));
    }

    guildState.textChannelId = interaction.channelId;
    logger.debug('Bound guild state to interaction text channel.', buildGuildMeta(guildState, {
      channelId: interaction.channelId,
    }));
    return guildState.connection;
  }

  function requireSameVoiceChannel(interaction, guildState) {
    const userChannelId = interaction.member?.voice?.channelId;
    const botChannelId = guildState.connection?.joinConfig?.channelId || null;

    if (!botChannelId) {
      logger.warn('Voice channel validation failed because bot is not connected.', buildGuildMeta(guildState, {
        userId: interaction.user?.id || null,
      }));
      throw new Error('Bot chua o trong voice channel nao.');
    }

    if (!userChannelId || userChannelId !== botChannelId) {
      logger.warn('Voice channel validation failed because user is in a different channel.', buildGuildMeta(guildState, {
        userId: interaction.user?.id || null,
        userChannelId: userChannelId || null,
        botChannelId,
      }));
      throw new Error('Ban phai vao cung voice channel voi bot de dung nut nay.');
    }
  }

  function enqueuePlaylistToGuildWithOptions(guildState, playlist, requestedBy, options = {}) {
    const shuffle = Boolean(options.shuffle) || guildState.shuffleMode;
    const list = shuffle ? shuffleArray([...playlist.tracks]) : [...playlist.tracks];
    list.forEach((track) => {
      guildState.tracks.push(mapTrackForQueue(track, requestedBy));
    });
    if (guildState.queueInfiniteMode) {
      guildState.queueInfiniteTemplate = snapshotQueueForInfinite(guildState);
    }
    logger.info('Enqueued playlist to guild queue with options.', buildGuildMeta(guildState, {
      playlistName: playlist.name || 'unknown',
      addedTracks: list.length,
      requestedBy,
      shuffle,
    }));
  }

  function configurePlaylistLoop(guildState, playlist, requestedBy, options = {}) {
    const infinite = Boolean(options.infinite);

    if (!infinite) {
      guildState.queueInfiniteMode = false;
      guildState.queueInfiniteTemplate = null;
      guildState.playlistLoopTemplate = null;
      guildState.playlistLoopRequestedBy = null;
      logger.info('Playlist loop disabled.', buildGuildMeta(guildState));
      return;
    }

    guildState.queueInfiniteMode = false;
    guildState.queueInfiniteTemplate = null;
    guildState.playlistLoopTemplate = playlist.tracks.map((t) => ({
      url: t.url,
      title: t.title,
      durationSec: t.durationSec || 0,
      thumbnail: t.thumbnail || null,
    }));
    guildState.playlistLoopRequestedBy = requestedBy;
    logger.info('Playlist loop enabled.', buildGuildMeta(guildState, {
      playlistName: playlist.name || 'unknown',
      templateLength: playlist.tracks.length,
      requestedBy,
      shuffle: guildState.shuffleMode,
    }));
  }

  function enqueueTrack(guildState, track) {
    guildState.tracks.push(mapTrackForQueue(track, track.requestedBy || 'Không rõ'));
    if (guildState.queueInfiniteMode) {
      guildState.queueInfiniteTemplate = snapshotQueueForInfinite(guildState);
    }
  }

  function clearAndDisconnect(guildState) {
    logger.info('Clearing queue and disconnecting voice connection.', buildGuildMeta(guildState));
    guildState.tracks = [];
    guildState.current = null;
    guildState.isPaused = false;
    guildState.currentStartedAtMs = 0;
    guildState.pausedElapsedMs = 0;
    releaseActiveResource(guildState);
    guildState.player.stop();
    guildState.connection?.destroy();
    guildState.connection = null;
    guildState.history = [];
    guildState.queueInfiniteMode = false;
    guildState.queueInfiniteTemplate = null;
    guildState.shuffleMode = false;
    guildState.playlistLoopTemplate = null;
    guildState.playlistLoopRequestedBy = null;
    
    if (guildState.idleTimer) {
      clearTimeout(guildState.idleTimer);
      guildState.idleTimer = null;
    }

    if (guildState.emptyVoiceTimer) {
      clearTimeout(guildState.emptyVoiceTimer);
      guildState.emptyVoiceTimer = null;
    }
    
    logger.info('Guild player state cleared.', buildGuildMeta(guildState));
  }

  function handleVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const guildState = queue.get(guild?.id);
    const botChannelId = guildState?.connection?.joinConfig?.channelId || null;
    if (!guildState || !botChannelId) return;

    const channel = guild.channels.cache.get(botChannelId);
    const listenerCount = channel?.members?.filter((member) => !member.user.bot).size || 0;

    if (listenerCount > 0) {
      if (guildState.emptyVoiceTimer) {
        clearTimeout(guildState.emptyVoiceTimer);
        guildState.emptyVoiceTimer = null;
        logger.info('Canceled empty voice timeout because a listener is present.', buildGuildMeta(guildState, {
          listenerCount,
        }));
      }
      return;
    }

    if (guildState.emptyVoiceTimer) return;
    logger.info('Voice channel has no listeners. Starting 60s disconnect timer.', buildGuildMeta(guildState));
    guildState.emptyVoiceTimer = setTimeout(async () => {
      guildState.emptyVoiceTimer = null;
      const activeChannelId = guildState.connection?.joinConfig?.channelId || null;
      const activeChannel = activeChannelId ? guild.channels.cache.get(activeChannelId) : null;
      const activeListeners = activeChannel?.members?.filter((member) => !member.user.bot).size || 0;
      if (!activeChannelId || activeListeners > 0) return;

      logger.info('Empty voice timeout reached. Ending playback session.', buildGuildMeta(guildState));
      clearAndDisconnect(guildState);
      await panelService.upsertNowPlayingPanel(guildState).catch(() => null);
      await sendTextNotice(guildState, '👋 Không còn người nghe trong voice. Bot đã dừng nhạc và rời kênh.');
    }, 60_000);
  }

  async function shutdownAll() {
    for (const guildState of queue.values()) {
      clearAndDisconnect(guildState);
    }
  }

  return {
    clearAndDisconnect,
    enqueueTrack,
    ensureConnection,
    enqueuePlaylistToGuildWithOptions,
    configurePlaylistLoop,
    getGuildState,
    handleVoiceStateUpdate,
    playNext,
    playPrevious,
    queue,
    requireSameVoiceChannel,
    shutdownAll,
    toggleInfiniteMode,
    toggleShuffleMode,
  };
}

module.exports = {
  createPlayerService,
};
