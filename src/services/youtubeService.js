const { createAudioResource, StreamType } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const play = require('play-dl');
const ytDlp = require('yt-dlp-exec');
const { Readable } = require('node:stream');
const { createLogger } = require('../utils/logger');

const logger = createLogger('youtube');

function normalizePlayableUrl(input) {
  const raw = String(input || '').trim().replace(/^<|>$/g, '');
  if (!raw) throw new Error('Invalid URL: empty input.');

  if (ytdl.validateID(raw)) {
    return `https://www.youtube.com/watch?v=${raw}`;
  }

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate) && /youtube\.com|youtu\.be/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const videoId = parsed.searchParams.get('v');
      if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;

      const shortsMatch = parsed.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
      if (shortsMatch) return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
    }

    if (host === 'youtu.be') {
      const videoId = parsed.pathname.split('/').filter(Boolean)[0];
      if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    }
  } catch {
    // handled below
  }

  throw new Error('Invalid URL: only YouTube video links are supported.');
}

function detectInputType(mediaUrl, contentType) {
  const lowerUrl = String(mediaUrl || '').toLowerCase();
  const lowerType = String(contentType || '').toLowerCase();

  if (lowerUrl.includes('.webm') || lowerType.includes('webm')) return StreamType.WebmOpus;
  if (lowerUrl.includes('.ogg') || lowerType.includes('ogg')) return StreamType.OggOpus;
  return StreamType.Arbitrary;
}

function mapPlayDlStreamType(type) {
  switch (String(type || '').toLowerCase()) {
    case 'webm/opus':
      return StreamType.WebmOpus;
    case 'ogg/opus':
      return StreamType.OggOpus;
    case 'opus':
      return StreamType.Opus;
    case 'raw':
      return StreamType.Raw;
    default:
      return StreamType.Arbitrary;
  }
}

async function createAudioResourceWithYtDlp(url) {
  logger.info('Creating audio resource via yt-dlp.', { url });
  const output = await ytDlp(url, {
    getUrl: true,
    jsRuntimes: 'node',
    noPlaylist: true,
    noWarnings: true,
    format: 'bestaudio[acodec=opus][ext=webm]/bestaudio[acodec=opus]/bestaudio/best',
  });

  const mediaUrl = String(output || '').trim().split(/\r?\n/).find(Boolean);
  if (!mediaUrl) {
    throw new Error('yt-dlp did not return a media URL.');
  }

  logger.debug('yt-dlp returned media URL.', { url, mediaUrl });

  const response = await fetch(mediaUrl, {
    headers: { 'user-agent': 'Mozilla/5.0' },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch media stream (${response.status}).`);
  }

  const inputType = detectInputType(mediaUrl, response.headers.get('content-type'));
  logger.info('Fetched media stream via yt-dlp URL.', {
    url,
    mediaUrl,
    inputType,
    contentType: response.headers.get('content-type'),
    status: response.status,
  });
  const stream = Readable.fromWeb(response.body);
  return createAudioResource(stream, { inputType });
}

async function createAudioResourceWithYtdl(url) {
  logger.info('Creating audio resource via ytdl-core.', { url });
  const info = await ytdl.getInfo(url);
  const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

  const preferred = audioFormats.find((f) => f.codecs?.includes('opus') && (f.container === 'webm' || f.container === 'ogg'))
    || audioFormats.find((f) => f.hasAudio && !f.hasVideo)
    || null;

  if (!preferred) {
    throw new Error('No suitable audio format from ytdl.');
  }

  logger.info('Selected ytdl-core audio format.', {
    url,
    formatUrl: preferred.url,
    container: preferred.container,
    codecs: preferred.codecs,
    mimeType: preferred.mimeType,
    bitrate: preferred.bitrate,
    audioBitrate: preferred.audioBitrate,
  });

  const stream = ytdl.downloadFromInfo(info, {
    format: preferred,
    highWaterMark: 1 << 25,
    dlChunkSize: 0,
  });

  let inputType = StreamType.Arbitrary;
  if (preferred.container === 'webm' && preferred.codecs?.includes('opus')) inputType = StreamType.WebmOpus;
  if (preferred.container === 'ogg' && preferred.codecs?.includes('opus')) inputType = StreamType.OggOpus;

  return createAudioResource(stream, { inputType });
}

async function createYoutubeAudioResource(url) {
  logger.info('Starting stream resolution chain.', { url, chain: ['play-dl', 'yt-dlp', 'ytdl-core'] });
  // Ưu tiên dùng play-dl vì nó ổn định nhất trên VPS hiện nay
  try {
    const stream = await play.stream(url);
    logger.info('play-dl stream resolved successfully.', {
      url,
      streamType: stream.type,
      source: 'play-dl',
    });
    return createAudioResource(stream.stream, {
      inputType: mapPlayDlStreamType(stream.type),
    });
  } catch (playDlError) {
    logger.warn('play-dl stream failed; falling back to yt-dlp.', {
      url,
      fallbackTo: 'yt-dlp',
      error: playDlError,
    });
  }

  // Fallback sang yt-dlp nếu play-dl lỗi
  try {
    const resource = await createAudioResourceWithYtDlp(url);
    logger.info('yt-dlp stream resolved successfully.', { url, source: 'yt-dlp' });
    return resource;
  } catch (ytDlpError) {
    logger.warn('yt-dlp stream failed; falling back to ytdl-core.', {
      url,
      fallbackTo: 'ytdl-core',
      error: ytDlpError,
    });
  }

  try {
    const resource = await createAudioResourceWithYtdl(url);
    logger.info('ytdl-core stream resolved successfully.', { url, source: 'ytdl-core' });
    return resource;
  } catch (fallbackError) {
    logger.error('All stream providers failed for URL.', {
      url,
      attemptedProviders: ['play-dl', 'yt-dlp', 'ytdl-core'],
      error: fallbackError,
    });
    throw fallbackError;
  }
}


async function getVideoMetadataWithYtDlp(url) {
  logger.debug('Fetching metadata via yt-dlp.', { url });
  const json = await ytDlp(url, {
    dumpSingleJson: true,
    jsRuntimes: 'node',
    noPlaylist: true,
    noWarnings: true,
    skipDownload: true,
  });

  return {
    title: json?.title || url,
    durationSec: Number(json?.duration || 0) || 0,
    thumbnail: json?.thumbnail || null,
  };
}

async function getVideoMetadataWithYtdl(url) {
  logger.debug('Fetching metadata via ytdl-core.', { url });
  const info = await ytdl.getBasicInfo(url);
  const title = info.videoDetails?.title || url;
  const durationSec = Number(info.videoDetails?.lengthSeconds || 0) || 0;
  const thumbList = info.videoDetails?.thumbnails || [];
  const thumbnail = thumbList.length > 0 ? thumbList[thumbList.length - 1].url : null;
  return { title, durationSec, thumbnail };
}

async function getVideoMetadata(url) {
  try {
    const metadata = await getVideoMetadataWithYtDlp(url);
    logger.info('Metadata resolved via yt-dlp.', {
      url,
      title: metadata.title,
      durationSec: metadata.durationSec,
    });
    return metadata;
  } catch (primaryError) {
    logger.warn('yt-dlp metadata failed; falling back to ytdl-core.', {
      url,
      fallbackTo: 'ytdl-core',
      error: primaryError,
    });
  }

  try {
    const metadata = await getVideoMetadataWithYtdl(url);
    logger.info('Metadata resolved via ytdl-core.', {
      url,
      title: metadata.title,
      durationSec: metadata.durationSec,
    });
    return metadata;
  } catch (fallbackError) {
    logger.error('All metadata providers failed for URL.', {
      url,
      attemptedProviders: ['yt-dlp', 'ytdl-core'],
      error: fallbackError,
    });
    throw fallbackError;
  }
}

async function searchYoutubeVideo(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Tu khoa tim kiem dang trong.');
  logger.info('Searching YouTube video.', { query: q });

  const result = await ytDlp(`ytsearch1:${q}`, {
    dumpSingleJson: true,
    jsRuntimes: 'node',
    noWarnings: true,
    skipDownload: true,
    defaultSearch: 'ytsearch',
  });

  const item = result?.entries?.[0] || result;
  if (!item) {
    throw new Error('Khong tim thay ket qua phu hop.');
  }

  const url = item.webpage_url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null);
  if (!url) {
    throw new Error('Khong lay duoc URL tu ket qua tim kiem.');
  }

  logger.info('YouTube search resolved a video.', {
    query: q,
    title: item.title || q,
    url,
    durationSec: Number(item.duration || 0) || 0,
  });
  return {
    url: normalizePlayableUrl(url),
    title: item.title || q,
    durationSec: Number(item.duration || 0) || 0,
    thumbnail: item.thumbnail || null,
  };
}

function toYoutubeVideoUrl(entry) {
  if (!entry) return null;
  if (entry.webpage_url) return normalizePlayableUrl(entry.webpage_url);
  if (entry.url) {
    try {
      return normalizePlayableUrl(entry.url);
    } catch {
      // fall through to other fields
    }
  }
  if (entry.id) return normalizePlayableUrl(`https://www.youtube.com/watch?v=${entry.id}`);
  return null;
}

function deriveSeedVideoIdFromListId(listId) {
  const raw = String(listId || '').trim();
  if (!raw.startsWith('RD')) return null;

  const directMatch = raw.match(/^RD(?:MM)?([A-Za-z0-9_-]{11})$/);
  if (directMatch) return directMatch[1];

  const tailMatch = raw.match(/([A-Za-z0-9_-]{11})$/);
  return tailMatch ? tailMatch[1] : null;
}

function parseYoutubePlaylistInput(playlistUrl) {
  const raw = String(playlistUrl || '').trim().replace(/^<|>$/g, '');
  if (!raw) throw new Error('Thieu URL playlist YouTube.');

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate) && /youtube\.com|youtu\.be/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const supportedHosts = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
    if (!supportedHosts.has(host)) {
      throw new Error('Chi ho tro link playlist YouTube.');
    }

    const listId = parsed.searchParams.get('list');
    if (!listId) {
      throw new Error('Link nay khong chua ma playlist YouTube.');
    }

    const rawVideoId = host === 'youtu.be'
      ? parsed.pathname.split('/').filter(Boolean)[0] || parsed.searchParams.get('v')
      : parsed.searchParams.get('v');
    const seedVideoId = ytdl.validateID(rawVideoId || '')
      ? rawVideoId
      : deriveSeedVideoIdFromListId(listId);

    return {
      canonical: `https://www.youtube.com/playlist?list=${listId}`,
      listId,
      seedVideoId,
    };
  } catch (error) {
    if (error instanceof Error && error.message !== 'Invalid URL') {
      throw error;
    }
    throw new Error('URL playlist YouTube khong hop le.');
  }
}

function mapPlaylistEntry(entry) {
  const url = toYoutubeVideoUrl(entry);
  if (!url) return null;

  const thumbnails = Array.isArray(entry?.thumbnails) ? entry.thumbnails : [];
  return {
    url,
    title: entry.title || url,
    durationSec: Number(entry.durationInSec || entry.duration || 0) || 0,
    thumbnail: entry.thumbnail?.url || entry.thumbnail || thumbnails[thumbnails.length - 1]?.url || null,
  };
}

function mapPlaylistEntries(entries) {
  return entries.map(mapPlaylistEntry).filter(Boolean);
}

function getErrorText(error) {
  if (!error) return '';
  return [error.stderr, error.shortMessage, error.message]
    .filter(Boolean)
    .map((part) => String(part))
    .join(' | ');
}

function isUnviewablePlaylistError(error) {
  const detail = getErrorText(error).toLowerCase();
  return detail.includes('playlist type is unviewable') || detail.includes('this playlist type is unviewable');
}

async function fetchYoutubePlaylistTracksWithYtDlp(canonical) {
  logger.info('Fetching playlist via yt-dlp.', { canonical });
  const json = await ytDlp(canonical, {
    dumpSingleJson: true,
    jsRuntimes: 'node',
    noWarnings: true,
    skipDownload: true,
    flatPlaylist: true,
  });

  const tracks = mapPlaylistEntries(Array.isArray(json?.entries) ? json.entries : []);
  if (tracks.length === 0) {
    throw new Error('Khong lay duoc bai hat tu playlist YouTube nay.');
  }

  logger.info('yt-dlp playlist fetch succeeded.', {
    canonical,
    title: json?.title || 'YouTube Playlist',
    trackCount: tracks.length,
  });
  return {
    title: json?.title || 'YouTube Playlist',
    tracks,
  };
}

async function fetchYoutubePlaylistTracksWithPlayDl(canonical) {
  logger.info('Fetching playlist via play-dl.', { canonical });
  const playlist = await play.playlist_info(canonical, { incomplete: true });
  const videos = await playlist.all_videos();
  const tracks = mapPlaylistEntries(Array.isArray(videos) ? videos : []);

  if (tracks.length === 0) {
    throw new Error('Khong lay duoc bai hat tu playlist YouTube nay.');
  }

  logger.info('play-dl playlist fetch succeeded.', {
    canonical,
    title: playlist?.title || 'YouTube Playlist',
    trackCount: tracks.length,
  });
  return {
    title: playlist?.title || 'YouTube Playlist',
    tracks,
  };
}

async function buildSeedVideoFallbackPlaylist(seedVideoId) {
  const url = `https://www.youtube.com/watch?v=${seedVideoId}`;
  const notice = 'Playlist nay la Mix/Radio cua YouTube, bot khong the lay toan bo danh sach nen da chuyen sang bai goc.';

  try {
    const meta = await getVideoMetadata(url);
    return {
      title: meta.title || 'YouTube Mix',
      tracks: [{
        url,
        title: meta.title || url,
        durationSec: meta.durationSec,
        thumbnail: meta.thumbnail,
      }],
      notice,
    };
  } catch (error) {
    logger.warn('Seed video metadata fallback failed; returning minimal single-track playlist.', {
      url,
      error,
    });
    return {
      title: 'YouTube Mix',
      tracks: [{
        url,
        title: url,
        durationSec: 0,
        thumbnail: null,
      }],
      notice,
    };
  }
}

function buildPlaylistFetchError(error, sawUnviewableError = false) {
  if (sawUnviewableError || isUnviewablePlaylistError(error)) {
    return new Error('Playlist YouTube nay khong ho tro trich xuat day du (thuong la Mix/Radio). Hay gui link video hoac playlist thuong.');
  }
  return new Error('Khong lay duoc bai hat tu playlist YouTube nay.');
}

async function fetchYoutubePlaylistTracks(playlistUrl) {
  const { canonical, seedVideoId } = parseYoutubePlaylistInput(playlistUrl);
  let lastError = null;
  let sawUnviewableError = false;

  logger.info('Starting playlist resolution chain.', {
    playlistUrl,
    canonical,
    seedVideoId,
    chain: ['yt-dlp', 'play-dl', 'seed-video-fallback-if-mix'],
  });

  try {
    return await fetchYoutubePlaylistTracksWithYtDlp(canonical);
  } catch (error) {
    lastError = error;
    sawUnviewableError = sawUnviewableError || isUnviewablePlaylistError(error);
    logger.warn('yt-dlp playlist fetch failed; falling back to play-dl.', {
      canonical,
      fallbackTo: 'play-dl',
      sawUnviewableError,
      error,
      errorText: getErrorText(error),
    });
  }

  try {
    return await fetchYoutubePlaylistTracksWithPlayDl(canonical);
  } catch (error) {
    lastError = error;
    sawUnviewableError = sawUnviewableError || isUnviewablePlaylistError(error);
    logger.warn('play-dl playlist fetch failed.', {
      canonical,
      sawUnviewableError,
      seedVideoId,
      error,
      errorText: getErrorText(error),
    });
  }

  if (seedVideoId && sawUnviewableError) {
    logger.warn('Playlist appears to be an unviewable Mix/Radio; falling back to seed video.', {
      canonical,
      seedVideoId,
    });
    return buildSeedVideoFallbackPlaylist(seedVideoId);
  }

  logger.error('Playlist resolution failed with no remaining fallback.', {
    canonical,
    seedVideoId,
    sawUnviewableError,
    error: lastError,
    errorText: getErrorText(lastError),
  });
  throw buildPlaylistFetchError(lastError, sawUnviewableError);
}

module.exports = {
  createYoutubeAudioResource,
  fetchYoutubePlaylistTracks,
  getVideoMetadata,
  normalizePlayableUrl,
  searchYoutubeVideo,
};
