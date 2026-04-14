const {
  joinVoiceChannel,
  createAudioPlayer,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  entersState,
  VoiceConnectionStatus,
} = require('@discordjs/voice');

function createPlayerService({ youtubeService, panelService }) {
  const queue = new Map();

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
      };

      guildState.player.on(AudioPlayerStatus.Playing, () => {
        panelService.startProgressTicker(guildState);
        panelService.upsertNowPlayingPanel(guildState).catch(console.error);
      });

      guildState.player.on(AudioPlayerStatus.Idle, () => {
        playNext(null, guildState).catch(console.error);
      });

      guildState.player.on('error', (error) => {
        console.error(`Audio player error (guild ${guildId}):`, error.message);
        playNext(null, guildState).catch(console.error);
      });

      queue.set(guildId, guildState);
    }
    return queue.get(guildId);
  }

  async function playNext(interaction, guildState) {
    if (guildState.tracks.length === 0 && guildState.queueInfiniteMode && guildState.queueInfiniteTemplate?.length) {
      guildState.tracks.push(
        ...guildState.queueInfiniteTemplate.map((track) => mapTrackForQueue(track, track.requestedBy || 'Infinite Queue')),
      );
    }

    if (guildState.tracks.length === 0 && guildState.playlistLoopTemplate?.length) {
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

      if (guildState.current) {
        guildState.history.push(guildState.current);
        if (guildState.history.length > 100) guildState.history.shift();
      }

      guildState.current = next;
      guildState.isPaused = false;
      guildState.currentStartedAtMs = Date.now();
      guildState.pausedElapsedMs = 0;

      try {
        const resource = await youtubeService.createYoutubeAudioResource(next.url);
        guildState.player.play(resource);
        return;
      } catch (streamError) {
        console.error(`Skip track due to stream error (${next.url}):`, streamError.message);
      }
    }

    guildState.current = null;
    guildState.isPaused = false;
    guildState.currentStartedAtMs = 0;
    guildState.pausedElapsedMs = 0;
    panelService.stopProgressTicker(guildState);
    await panelService.upsertNowPlayingPanel(guildState).catch(() => null);
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
      return false;
    }

    const snapshot = snapshotQueueForInfinite(guildState);
    if (snapshot.length === 0) {
      throw new Error('Khong co bai de bat che do infinite.');
    }

    guildState.queueInfiniteMode = true;
    guildState.queueInfiniteTemplate = snapshot;
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
    guildState.player.stop();
  }

  async function ensureConnection(interaction, guildState) {
    const memberChannel = interaction.member?.voice?.channel;
    if (!memberChannel) {
      throw new Error('Ban phai vao voice channel truoc da.');
    }

    if (!guildState.connection) {
      guildState.connection = joinVoiceChannel({
        channelId: memberChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      await entersState(guildState.connection, VoiceConnectionStatus.Ready, 20_000);
      guildState.connection.subscribe(guildState.player);
    }

    guildState.textChannelId = interaction.channelId;
  }

  function setActiveTextChannel(guildId, channelId) {
    if (!guildId || !channelId) return;
    const guildState = getGuildState(guildId);
    guildState.textChannelId = channelId;
  }

  function requireSameVoiceChannel(interaction, guildState) {
    const userChannelId = interaction.member?.voice?.channelId;
    const botChannelId = guildState.connection?.joinConfig?.channelId || null;

    if (!botChannelId) {
      throw new Error('Bot chua o trong voice channel nao.');
    }

    if (!userChannelId || userChannelId !== botChannelId) {
      throw new Error('Ban phai vao cung voice channel voi bot de dung nut nay.');
    }
  }

  function enqueuePlaylistToGuild(guildState, playlist, requestedBy) {
    playlist.tracks.forEach((track) => {
      guildState.tracks.push(mapTrackForQueue(track, requestedBy));
    });
  }

  function enqueuePlaylistToGuildWithOptions(guildState, playlist, requestedBy, options = {}) {
    const shuffle = Boolean(options.shuffle);
    const list = shuffle ? shuffleArray(playlist.tracks) : [...playlist.tracks];
    list.forEach((track) => {
      guildState.tracks.push(mapTrackForQueue(track, requestedBy));
    });
  }

  function configurePlaylistLoop(guildState, playlist, requestedBy, options = {}) {
    const infinite = Boolean(options.infinite);
    const shuffle = Boolean(options.shuffle);

    if (!infinite) {
      guildState.playlistLoopTemplate = null;
      guildState.playlistLoopShuffle = false;
      guildState.playlistLoopRequestedBy = null;
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
  }

  function clearAndDisconnect(guildState) {
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
