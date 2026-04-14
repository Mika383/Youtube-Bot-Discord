const { createAudioResource, StreamType } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const ytDlp = require('yt-dlp-exec');
const { Readable } = require('node:stream');

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

async function createAudioResourceWithYtDlp(url) {
  const output = await ytDlp(url, {
    getUrl: true,
    noPlaylist: true,
    noWarnings: true,
    format: 'bestaudio[acodec=opus][ext=webm]/bestaudio[acodec=opus]/bestaudio/best',
  });

  const mediaUrl = String(output || '').trim().split(/\r?\n/).find(Boolean);
  if (!mediaUrl) {
    throw new Error('yt-dlp did not return a media URL.');
  }

  const response = await fetch(mediaUrl, {
    headers: { 'user-agent': 'Mozilla/5.0' },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch media stream (${response.status}).`);
  }

  const inputType = detectInputType(mediaUrl, response.headers.get('content-type'));
  const stream = Readable.fromWeb(response.body);
  return createAudioResource(stream, { inputType });
}

async function createYoutubeAudioResource(url) {
  try {
    const info = await ytdl.getInfo(url);
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

    const preferred = audioFormats.find((f) => f.codecs?.includes('opus') && (f.container === 'webm' || f.container === 'ogg'))
      || audioFormats.find((f) => f.hasAudio && !f.hasVideo)
      || null;

    if (!preferred) {
      throw new Error('No suitable audio format from ytdl.');
    }

    const stream = ytdl.downloadFromInfo(info, {
      format: preferred,
      highWaterMark: 1 << 25,
      dlChunkSize: 0,
    });

    let inputType = StreamType.Arbitrary;
    if (preferred.container === 'webm' && preferred.codecs?.includes('opus')) inputType = StreamType.WebmOpus;
    if (preferred.container === 'ogg' && preferred.codecs?.includes('opus')) inputType = StreamType.OggOpus;

    return createAudioResource(stream, { inputType });
  } catch (primaryError) {
    console.warn(`ytdl-core failed for ${url}: ${primaryError.message}`);
    return createAudioResourceWithYtDlp(url);
  }
}

async function getVideoMetadata(url) {
  try {
    const info = await ytdl.getBasicInfo(url);
    const title = info.videoDetails?.title || url;
    const durationSec = Number(info.videoDetails?.lengthSeconds || 0) || 0;
    const thumbList = info.videoDetails?.thumbnails || [];
    const thumbnail = thumbList.length > 0 ? thumbList[thumbList.length - 1].url : null;
    return { title, durationSec, thumbnail };
  } catch (primaryError) {
    console.warn(`ytdl-core basic info failed for ${url}: ${primaryError.message}`);
    const json = await ytDlp(url, {
      dumpSingleJson: true,
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
}

async function searchYoutubeVideo(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Tu khoa tim kiem dang trong.');

  const result = await ytDlp(`ytsearch1:${q}`, {
    dumpSingleJson: true,
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
  if (entry.url && String(entry.url).includes('youtube.com/watch')) return normalizePlayableUrl(entry.url);
  if (entry.id) return normalizePlayableUrl(`https://www.youtube.com/watch?v=${entry.id}`);
  return null;
}

async function fetchYoutubePlaylistTracks(playlistUrl) {
  const input = String(playlistUrl || '').trim();
  if (!input) throw new Error('Thieu URL playlist YouTube.');

  let canonical = input;
  try {
    const parsed = new URL(input);
    const listId = parsed.searchParams.get('list');
    if (listId) {
      canonical = `https://www.youtube.com/playlist?list=${listId}`;
    }
  } catch {
    // keep original
  }

  const json = await ytDlp(canonical, {
    dumpSingleJson: true,
    noWarnings: true,
    skipDownload: true,
    flatPlaylist: true,
  });

  const entries = Array.isArray(json?.entries) ? json.entries : [];
  const tracks = entries
    .map((entry) => {
      const url = toYoutubeVideoUrl(entry);
      if (!url) return null;
      return {
        url,
        title: entry.title || url,
        durationSec: Number(entry.duration || 0) || 0,
        thumbnail: entry.thumbnail || null,
      };
    })
    .filter(Boolean);

  if (tracks.length === 0) {
    throw new Error('Khong lay duoc bai hat tu playlist YouTube nay.');
  }

  return {
    title: json?.title || 'YouTube Playlist',
    tracks,
  };
}

module.exports = {
  createYoutubeAudioResource,
  fetchYoutubePlaylistTracks,
  getVideoMetadata,
  normalizePlayableUrl,
  searchYoutubeVideo,
};
