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

function createPlayerService({ youtubeService, panelService }) {
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
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
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
        progressTimer: null,
        isPaused: false,
        currentStartedAtMs: 0,
        pausedElapsedMs: 0,
        history: [],
        queueInfiniteMode: false,
        queueInfiniteTemplate: null,
        playlistLoopTemplate: null,
        playlistLoopShuffle: false,
        playlistLoopRequestedBy: null,
        idleTimer: null,
      };

      logger.info('Created guild player state.', buildGuildMeta(guildState));

      guildState.player.on(AudioPlayerStatus.Playing, () => {
        logger.info('Audio player entered Playing state.', buildGuildMeta(guildState));
        panelService.startProgressTicker(guildState);
        panelService.upsertNowPlayingPanel(guildState).catch((error) => {
          logger.error('Failed to update now playing panel while entering Playing.', {
            ...buildGuildMeta(guildState),
            error,
          });
        });
      });

      guildState.player.on(AudioPlayerStatus.Idle, () => {
        logger.info('Audio player entered Idle state.', buildGuildMeta(guildState));
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

  async function playNext(interaction, guildState) {
    logger.info('Attempting to play next track.', buildGuildMeta(guildState, {
      triggeredByUserId: interaction?.user?.id || null,
      triggeredByCommand: interaction?.commandName || null,
    }));

    if (guildState.tracks.length === 0 && guildState.queueInfiniteMode && guildState.queueInfiniteTemplate?.length) {
      logger.info('Rehydrating queue from infinite queue template.', buildGuildMeta(guildState, {
        templateLength: guildState.queueInfiniteTemplate.length,
      }));
      guildState.tracks.push(
        ...guildState.queueInfiniteTemplate.map((track) => mapTrackForQueue(track, track.requestedBy || 'Infinite Queue')),
      );
    }

    if (guildState.tracks.length === 0 && guildState.playlistLoopTemplate?.length) {
      logger.info('Rehydrating queue from playlist loop template.', buildGuildMeta(guildState, {
        templateLength: guildState.playlistLoopTemplate.length,
        shuffle: guildState.playlistLoopShuffle,
      }));
      const loopTracks = guildState.playlistLoopShuffle
        ? shuffleArray(guildState.playlistLoopTemplate)
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
        guildState.player.play(resource);
        logger.info('Audio player.play invoked.', buildGuildMeta(guildState, {
          nextTitle: next.title,
          nextUrl: next.url,
        }));
        return;
      } catch (streamError) {
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
    panelService.stopProgressTicker(guildState);
    logger.info('Queue exhausted; player state reset.', buildGuildMeta(guildState));
    await panelService.upsertNowPlayingPanel(guildState).catch((error) => {
      logger.error('Failed to update now playing panel after queue exhaustion.', {
        ...buildGuildMeta(guildState),
        error,
      });
      return null;
    });
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
    if (guildState.queueInfiniteMode) {
      guildState.queueInfiniteMode = false;
      guildState.queueInfiniteTemplate = null;
      logger.info('Infinite queue mode disabled.', buildGuildMeta(guildState));
      return false;
    }

    const snapshot = snapshotQueueForInfinite(guildState);
    if (snapshot.length === 0) {
      throw new Error('Khong co bai de bat che do infinite.');
    }

    guildState.queueInfiniteMode = true;
    guildState.queueInfiniteTemplate = snapshot;
    logger.info('Infinite queue mode enabled.', buildGuildMeta(guildState, {
      snapshotLength: snapshot.length,
    }));
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

    if (!guildState.connection) {
      logger.info('Joining voice channel.', buildGuildMeta(guildState, {
        userId: interaction.user?.id || null,
        memberVoiceChannelId: memberChannel.id,
        memberVoiceChannelName: memberChannel.name,
      }));
      guildState.connection = joinVoiceChannel({
        channelId: memberChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      guildState.connection.on('stateChange', (oldState, newState) => {
        logger.debug('Voice connection state changed.', buildGuildMeta(guildState, {
          oldStatus: oldState.status,
          newStatus: newState.status,
        }));
      });

      await entersState(guildState.connection, VoiceConnectionStatus.Ready, 20_000);
      guildState.connection.subscribe(guildState.player);
      logger.info('Voice connection is ready and subscribed to player.', buildGuildMeta(guildState, {
        memberVoiceChannelId: memberChannel.id,
        memberVoiceChannelName: memberChannel.name,
      }));
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
  }

  function setActiveTextChannel(guildId, channelId) {
    if (!guildId || !channelId) return;
    const guildState = getGuildState(guildId);
    const previousChannelId = guildState.textChannelId;
    guildState.textChannelId = channelId;
    if (previousChannelId !== channelId) {
      logger.info('Active text channel updated.', buildGuildMeta(guildState, {
        previousChannelId,
        channelId,
      }));
    }
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

  function enqueuePlaylistToGuild(guildState, playlist, requestedBy) {
    playlist.tracks.forEach((track) => {
      guildState.tracks.push(mapTrackForQueue(track, requestedBy));
    });
    logger.info('Enqueued playlist to guild queue.', buildGuildMeta(guildState, {
      playlistName: playlist.name || 'unknown',
      addedTracks: playlist.tracks.length,
      requestedBy,
    }));
  }

  function enqueuePlaylistToGuildWithOptions(guildState, playlist, requestedBy, options = {}) {
    const shuffle = Boolean(options.shuffle);
    const list = shuffle ? shuffleArray(playlist.tracks) : [...playlist.tracks];
    list.forEach((track) => {
      guildState.tracks.push(mapTrackForQueue(track, requestedBy));
    });
    logger.info('Enqueued playlist to guild queue with options.', buildGuildMeta(guildState, {
      playlistName: playlist.name || 'unknown',
      addedTracks: list.length,
      requestedBy,
      shuffle,
    }));
  }

  function configurePlaylistLoop(guildState, playlist, requestedBy, options = {}) {
    const infinite = Boolean(options.infinite);
    const shuffle = Boolean(options.shuffle);

    if (!infinite) {
      guildState.playlistLoopTemplate = null;
      guildState.playlistLoopShuffle = false;
      guildState.playlistLoopRequestedBy = null;
      logger.info('Playlist loop disabled.', buildGuildMeta(guildState));
      return;
    }

    guildState.playlistLoopTemplate = playlist.tracks.map((t) => ({
      url: t.url,
      title: t.title,
      durationSec: t.durationSec || 0,
      thumbnail: t.thumbnail || null,
    }));
    guildState.playlistLoopShuffle = shuffle;
    guildState.playlistLoopRequestedBy = requestedBy;
    logger.info('Playlist loop enabled.', buildGuildMeta(guildState, {
      playlistName: playlist.name || 'unknown',
      templateLength: playlist.tracks.length,
      requestedBy,
      shuffle,
    }));
  }

  function clearAndDisconnect(guildState) {
    logger.info('Clearing queue and disconnecting voice connection.', buildGuildMeta(guildState));
    guildState.tracks = [];
    guildState.current = null;
    guildState.isPaused = false;
    guildState.currentStartedAtMs = 0;
    guildState.pausedElapsedMs = 0;
    guildState.player.stop();
    guildState.connection?.destroy();
    guildState.connection = null;
    panelService.stopProgressTicker(guildState);
    guildState.history = [];
    guildState.queueInfiniteMode = false;
    guildState.queueInfiniteTemplate = null;
    guildState.playlistLoopTemplate = null;
    guildState.playlistLoopShuffle = false;
    guildState.playlistLoopRequestedBy = null;
    
    if (guildState.idleTimer) {
      clearTimeout(guildState.idleTimer);
      guildState.idleTimer = null;
    }
    
    logger.info('Guild player state cleared.', buildGuildMeta(guildState));
  }

  return {
    clearAndDisconnect,
    ensureConnection,
    enqueuePlaylistToGuild,
    enqueuePlaylistToGuildWithOptions,
    configurePlaylistLoop,
    getGuildState,
    playNext,
    playPrevious,
    queue,
    requireSameVoiceChannel,
    setActiveTextChannel,
    toggleInfiniteMode,
  };
}

module.exports = {
  createPlayerService,
};
