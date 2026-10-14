const { createAudioResource, StreamType } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const play = require('play-dl');
const ytDlp = require('yt-dlp-exec');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { createLogger } = require('../utils/logger');

const logger = createLogger('youtube');
const STREAM_START_TIMEOUT_MS = 15_000;
const FALLBACK_RESOLUTION_TIMEOUT_MS = 15_000;
const STREAM_BUFFER_BYTES = 256 * 1024;
const MAX_PROVIDER_ERROR_LENGTH = 2_000;
const YTDLP_OPUS_FORMAT = 'bestaudio[ext=webm][acodec=opus]';
const YOUTUBE_ACCESS_COOLDOWN_MS = 5 * 60 * 1000;
let youtubeAccessBlockedUntil = 0;
let youtubeAccessBlockReason = null;

function loadYoutubeCookieFile() {
  const configuredPath = String(process.env.YOUTUBE_COOKIES_FILE || '').trim();
  if (!configuredPath) return null;

  const resolvedPath = path.resolve(configuredPath);

  try {
    if (!path.isAbsolute(configuredPath)) {
      throw new Error('Cookie path must be absolute.');
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile() || stats.size === 0) {
      throw new Error('Cookie path is not a non-empty file.');
    }

    fs.accessSync(resolvedPath, fs.constants.R_OK);
    const lines = fs.readFileSync(resolvedPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    const firstLine = String(lines[0] || '').trim();
    if (firstLine !== '# Netscape HTTP Cookie File' && firstLine !== '# HTTP Cookie File') {
      throw new Error('Cookie file is not in Netscape format.');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const cookieRows = lines
      .map((line) => line.trim())
      .filter((line) => line && (!line.startsWith('#') || line.startsWith('#HttpOnly_')))
      .map((line) => line.split('\t'));
    const hasUsableCookie = cookieRows.some((fields) => {
      if (fields.length !== 7 || !fields[0] || !fields[5]) return false;
      const expiry = Number(fields[4]);
      return Number.isInteger(expiry) && (expiry === 0 || expiry > nowSeconds);
    });
    if (!hasUsableCookie) {
      throw new Error('Cookie file has no usable cookie rows.');
    }
  } catch {
    throw new Error('YOUTUBE_COOKIES_FILE must be an absolute path to a readable, non-empty Netscape cookie file.');
  }

  return resolvedPath;
}

const youtubeCookieFile = loadYoutubeCookieFile();

function buildYtDlpOptions(options = {}) {
  return {
    jsRuntimes: 'node',
    ...(youtubeCookieFile ? { cookies: youtubeCookieFile } : {}),
    ...options,
  };
}

function redactCookiePath(value) {
  let text = String(value || '');
  if (youtubeCookieFile) {
    text = text.split(youtubeCookieFile).join('[cookie-file]');
  }
  return text.replace(/--cookies(?:=|\s+)(?:"[^"]+"|'[^']+'|\S+)/gi, '--cookies [cookie-file]');
}

function sanitizeProviderError(value) {
  return redactCookiePath(value)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .trim()
    .slice(0, MAX_PROVIDER_ERROR_LENGTH);
}

function summarizeProviderError(error) {
  if (!error) return null;
  return {
    name: error.name,
    code: error.code,
    status: error.status,
    statusCode: error.statusCode,
    message: sanitizeProviderError(error.message),
    detail: sanitizeProviderError(error.detail || error.stderr || error.shortMessage),
  };
}

function classifyYoutubeAccessError(error) {
  const detail = getErrorText(error).toLowerCase();
  if (/\b(?:http error )?429\b/.test(detail) || detail.includes('too many requests')) {
    return 'rate-limited';
  }
  if (
    detail.includes('sign in to confirm you')
    || detail.includes('confirm you are not a bot')
    || detail.includes("confirm you're not a bot")
    || detail.includes('login_required')
    || detail.includes('login required')
  ) {
    return 'authentication-required';
  }
  return null;
}

function buildYoutubeAccessBlockedError(reason, retryAfterMs = YOUTUBE_ACCESS_COOLDOWN_MS) {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const error = new Error(`YouTube đang giới hạn hoặc yêu cầu xác minh. Vui lòng thử lại sau ${retryAfterSeconds} giây.`);
  error.code = 'YOUTUBE_ACCESS_COOLDOWN';
  error.reason = reason;
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function openYoutubeAccessCircuit(error, provider) {
  const reason = classifyYoutubeAccessError(error);
  if (!reason) return null;

  youtubeAccessBlockedUntil = Math.max(
    youtubeAccessBlockedUntil,
    Date.now() + YOUTUBE_ACCESS_COOLDOWN_MS,
  );
  youtubeAccessBlockReason = reason;
  logger.warn('YouTube access cooldown opened.', {
    provider,
    reason,
    cooldownSeconds: YOUTUBE_ACCESS_COOLDOWN_MS / 1000,
  });
  return buildYoutubeAccessBlockedError(reason);
}

function assertYoutubeAccessAvailable() {
  const remainingMs = youtubeAccessBlockedUntil - Date.now();
  if (remainingMs <= 0) {
    youtubeAccessBlockedUntil = 0;
    youtubeAccessBlockReason = null;
    return;
  }
  throw buildYoutubeAccessBlockedError(youtubeAccessBlockReason, remainingMs);
}

logger.info('YouTube cookie authentication configuration loaded.', {
  enabled: Boolean(youtubeCookieFile),
});

function buildProviderError(provider, message, detail = '') {
  const error = new Error(sanitizeProviderError(message));
  error.code = 'AUDIO_PROVIDER_ERROR';
  error.provider = provider;
  error.detail = sanitizeProviderError(detail);
  return error;
}

function withTimeout(promise, timeoutMs, label, onLateResolve = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(buildProviderError(label, `${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        if (settled) {
          try {
            onLateResolve?.(value);
          } catch (error) {
            logger.warn('Late provider result cleanup failed.', {
              label,
              error: summarizeProviderError(error),
            });
          }
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function waitForReadable(stream, timeoutMs, getEndError) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      stream.off('readable', onReadable);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };

    const onReadable = () => {
      if (stream.readableLength > 0) finish(resolve);
    };
    const onEnd = () => finish(reject, getEndError());
    const onError = (error) => finish(reject, error);
    const timer = setTimeout(() => {
      finish(reject, buildProviderError('yt-dlp', `yt-dlp did not produce audio within ${timeoutMs}ms.`));
    }, timeoutMs);

    stream.on('readable', onReadable);
    stream.once('end', onEnd);
    stream.once('error', onError);
    onReadable();
  });
}

function normalizePlayableUrl(input) {
  const raw = String(input || '').trim().replace(/^<|>$/g, '');
  if (!raw) throw new Error('URL không hợp lệ: nội dung đang trống.');

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

  throw new Error('URL không hợp lệ: bot chỉ hỗ trợ liên kết video YouTube.');
}

function classifyPlayInput(input) {
  const raw = String(input || '').trim().replace(/^<|>$/g, '');
  if (!raw) throw new Error('Thiếu tên bài hát hoặc URL cho `/play`.');

  const hasExplicitUrlScheme = /^https?:\/\//i.test(raw);
  const resemblesYoutubeUrl = /(?:youtube\.com|youtu\.be)/i.test(raw);
  if (!hasExplicitUrlScheme && !resemblesYoutubeUrl) {
    return { type: 'search', query: raw };
  }

  const candidate = hasExplicitUrlScheme ? raw : `https://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('URL YouTube không hợp lệ.');
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const supportedHosts = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
  if (!supportedHosts.has(host)) {
    throw new Error('Bot chỉ hỗ trợ URL YouTube; hãy nhập tên bài hát nếu muốn tìm kiếm.');
  }

  const listId = parsed.searchParams.get('list');
  if (listId && !listId.toUpperCase().startsWith('RD')) {
    return {
      type: 'playlist',
      listId,
      url: `https://www.youtube.com/playlist?list=${listId}`,
    };
  }

  try {
    return { type: 'video', url: normalizePlayableUrl(candidate) };
  } catch (error) {
    const seedVideoId = deriveSeedVideoIdFromListId(listId);
    if (seedVideoId && ytdl.validateID(seedVideoId)) {
      return {
        type: 'video',
        url: `https://www.youtube.com/watch?v=${seedVideoId}`,
      };
    }
    throw error;
  }
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

async function createAudioResourceWithYtDlp(url, options = {}) {
  const preferOpus = options.preferOpus !== false;
  const format = preferOpus ? YTDLP_OPUS_FORMAT : 'bestaudio/best';
  const inputType = preferOpus ? StreamType.WebmOpus : StreamType.Arbitrary;
  logger.info('Creating managed audio resource via yt-dlp.', {
    url,
    preferOpus,
    streamBufferBytes: STREAM_BUFFER_BYTES,
  });

  const child = ytDlp.exec(
    url,
    buildYtDlpOptions({
      output: '-',
      format,
      quiet: true,
      noPlaylist: true,
      noWarnings: true,
    }),
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  if (!child.stdout || !child.stderr) {
    child.kill();
    throw new Error('yt-dlp failed to initialize stdout stream.');
  }

  let stderr = '';
  let exitCode = null;
  let exitSignal = null;
  let cleaned = false;
  const bufferedStream = new PassThrough({ highWaterMark: STREAM_BUFFER_BYTES });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (stderr.length < MAX_PROVIDER_ERROR_LENGTH) stderr += chunk;
  });

  const buildExitError = () => buildProviderError(
    'yt-dlp',
    exitCode === null
      ? 'yt-dlp ended before producing audio.'
      : `yt-dlp exited with code ${exitCode}${exitSignal ? ` (${exitSignal})` : ''}.`,
    stderr,
  );

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (!bufferedStream.destroyed) bufferedStream.destroy();
    if (child.exitCode === null && child.signalCode === null && !child.killed) {
      child.kill();
    }
  };

  child.once('error', (error) => {
    if (!bufferedStream.destroyed) bufferedStream.destroy(error);
  });
  child.once('close', (code, signal) => {
    exitCode = code;
    exitSignal = signal;
    if (code !== 0 && !bufferedStream.destroyed) {
      bufferedStream.destroy(buildExitError());
    }
  });
  child.catch(() => null);
  child.stdout.pipe(bufferedStream);

  try {
    await waitForReadable(bufferedStream, STREAM_START_TIMEOUT_MS, buildExitError);
  } catch (error) {
    cleanup();
    throw error;
  }

  logger.info('yt-dlp produced initial audio data.', {
    url,
    preferOpus,
    bufferedBytes: bufferedStream.readableLength,
  });

  const resource = createAudioResource(bufferedStream, {
    inputType,
    metadata: {
      provider: preferOpus ? 'yt-dlp-webm-opus' : 'yt-dlp-generic',
      cleanup,
    },
  });

  bufferedStream.on('error', (error) => {
    openYoutubeAccessCircuit(error, 'yt-dlp');
    logger.error('Managed yt-dlp audio stream failed after startup.', {
      url,
      provider: resource.metadata.provider,
      error: summarizeProviderError(error),
    });
    if (!resource.playStream.destroyed) resource.playStream.destroy(error);
  });
  resource.playStream.once('close', cleanup);
  return resource;
}

async function createPreferredYtDlpAudioResource(url) {
  try {
    return await createAudioResourceWithYtDlp(url, { preferOpus: true });
  } catch (error) {
    const detail = `${error.message || ''} ${error.detail || ''}`.toLowerCase();
    const formatUnavailable = detail.includes('requested format is not available')
      || detail.includes('no video formats found')
      || detail.includes('format is not available');

    if (!formatUnavailable) throw error;

    logger.warn('Preferred WebM/Opus format is unavailable; using generic best audio.', {
      url,
      provider: error.provider || 'yt-dlp',
      error: summarizeProviderError(error),
    });
    return createAudioResourceWithYtDlp(url, { preferOpus: false });
  }
}

async function createAudioResourceWithPlayDl(url) {
  const stream = await withTimeout(
    play.stream(url),
    FALLBACK_RESOLUTION_TIMEOUT_MS,
    'play-dl',
    (lateStream) => lateStream?.stream?.destroy?.(),
  );
  const cleanup = () => stream.stream?.destroy?.();
  const resource = createAudioResource(stream.stream, {
    inputType: mapPlayDlStreamType(stream.type),
    metadata: { provider: 'play-dl', cleanup },
  });
  resource.playStream.once('close', cleanup);
  return resource;
}

async function createAudioResourceWithYtdl(url) {
  logger.info('Creating audio resource via ytdl-core.', { url });
  const info = await withTimeout(
    ytdl.getInfo(url),
    FALLBACK_RESOLUTION_TIMEOUT_MS,
    'ytdl-core',
  );
  const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

  const preferred = audioFormats.find((f) => f.codecs?.includes('opus') && (f.container === 'webm' || f.container === 'ogg'))
    || audioFormats.find((f) => f.hasAudio && !f.hasVideo)
    || null;

  if (!preferred) {
    throw new Error('No suitable audio format from ytdl.');
  }

  logger.info('Selected ytdl-core audio format.', {
    url,
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

  const cleanup = () => stream.destroy?.();
  const resource = createAudioResource(stream, {
    inputType,
    metadata: { provider: 'ytdl-core', cleanup },
  });
  resource.playStream.once('close', cleanup);
  return resource;
}

async function createYoutubeAudioResource(url) {
  assertYoutubeAccessAvailable();
  const providers = [
    ['yt-dlp', () => createPreferredYtDlpAudioResource(url)],
    ['play-dl', () => createAudioResourceWithPlayDl(url)],
    ['ytdl-core', () => createAudioResourceWithYtdl(url)],
  ];
  const failures = [];

  logger.info('Starting stream resolution chain.', {
    url,
    chain: providers.map(([name]) => name),
  });

  for (const [provider, createResource] of providers) {
    try {
      const resource = await createResource();
      logger.info('Audio stream provider is ready.', {
        url,
        provider: resource.metadata?.provider || provider,
      });
      return resource;
    } catch (error) {
      const accessBlockedError = openYoutubeAccessCircuit(error, provider);
      failures.push({
        provider,
        message: sanitizeProviderError(error.message || 'Unknown provider error'),
        detail: sanitizeProviderError(error.detail || null),
      });
      logger.warn('Audio stream provider failed.', {
        url,
        provider,
        fallbackTo: accessBlockedError ? null : providers[failures.length]?.[0] || null,
        error: summarizeProviderError(error),
      });
      if (accessBlockedError) throw accessBlockedError;
    }
  }

  const finalError = new Error('Không thể tạo luồng âm thanh từ YouTube lúc này. Vui lòng thử lại sau.');
  finalError.code = 'AUDIO_STREAM_UNAVAILABLE';
  finalError.failures = failures;
  logger.error('All audio stream providers failed.', {
    url,
    failures,
  });
  throw finalError;
}


async function getVideoMetadataWithYtDlp(url) {
  logger.debug('Fetching metadata via yt-dlp.', { url });
  const json = await ytDlp(url, buildYtDlpOptions({
    dumpSingleJson: true,
    noPlaylist: true,
    noWarnings: true,
    skipDownload: true,
  }));

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
  assertYoutubeAccessAvailable();
  try {
    const metadata = await getVideoMetadataWithYtDlp(url);
    logger.info('Metadata resolved via yt-dlp.', {
      url,
      title: metadata.title,
      durationSec: metadata.durationSec,
    });
    return metadata;
  } catch (primaryError) {
    const accessBlockedError = openYoutubeAccessCircuit(primaryError, 'yt-dlp');
    logger.warn('yt-dlp metadata failed; falling back to ytdl-core.', {
      url,
      fallbackTo: accessBlockedError ? null : 'ytdl-core',
      error: summarizeProviderError(primaryError),
    });
    if (accessBlockedError) throw accessBlockedError;
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
    const accessBlockedError = openYoutubeAccessCircuit(fallbackError, 'ytdl-core');
    logger.error('All metadata providers failed for URL.', {
      url,
      attemptedProviders: ['yt-dlp', 'ytdl-core'],
      error: summarizeProviderError(fallbackError),
    });
    if (accessBlockedError) throw accessBlockedError;
    throw fallbackError;
  }
}

async function searchYoutubeVideo(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Từ khóa tìm kiếm đang trống.');
  assertYoutubeAccessAvailable();
  logger.info('Searching YouTube video.', { query: q });

  let result;
  try {
    result = await ytDlp(`ytsearch1:${q}`, buildYtDlpOptions({
      dumpSingleJson: true,
      noWarnings: true,
      skipDownload: true,
      defaultSearch: 'ytsearch',
    }));
  } catch (error) {
    const accessBlockedError = openYoutubeAccessCircuit(error, 'yt-dlp');
    logger.warn('YouTube search failed.', {
      query: q,
      error: summarizeProviderError(error),
    });
    throw accessBlockedError || buildProviderError('yt-dlp', error.message, getErrorText(error));
  }

  const item = result?.entries?.[0] || result;
  if (!item) {
    throw new Error('Không tìm thấy kết quả phù hợp.');
  }

  const url = item.webpage_url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null);
  if (!url) {
    throw new Error('Không lấy được URL từ kết quả tìm kiếm.');
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
  if (!raw) throw new Error('Thiếu URL playlist YouTube.');

  let candidate = raw;
  if (!/^https?:\/\//i.test(candidate) && /youtube\.com|youtu\.be/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const supportedHosts = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
    if (!supportedHosts.has(host)) {
      throw new Error('Bot chỉ hỗ trợ liên kết playlist YouTube.');
    }

    const listId = parsed.searchParams.get('list');
    if (!listId) {
      throw new Error('Liên kết này không chứa mã playlist YouTube.');
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
    throw new Error('URL playlist YouTube không hợp lệ.');
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
  return [error.stderr, error.shortMessage, error.message, error.detail]
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
  const json = await ytDlp(canonical, buildYtDlpOptions({
    dumpSingleJson: true,
    noWarnings: true,
    skipDownload: true,
    flatPlaylist: true,
  }));

  const tracks = mapPlaylistEntries(Array.isArray(json?.entries) ? json.entries : []);
  if (tracks.length === 0) {
    throw new Error('Không lấy được bài hát từ playlist YouTube này.');
  }

  logger.info('yt-dlp playlist fetch succeeded.', {
    canonical,
    title: json?.title || 'Playlist YouTube',
    trackCount: tracks.length,
  });
  return {
    title: json?.title || 'Playlist YouTube',
    tracks,
  };
}

async function fetchYoutubePlaylistTracksWithPlayDl(canonical) {
  logger.info('Fetching playlist via play-dl.', { canonical });
  const playlist = await play.playlist_info(canonical, { incomplete: true });
  const videos = await playlist.all_videos();
  const tracks = mapPlaylistEntries(Array.isArray(videos) ? videos : []);

  if (tracks.length === 0) {
    throw new Error('Không lấy được bài hát từ playlist YouTube này.');
  }

  logger.info('play-dl playlist fetch succeeded.', {
    canonical,
    title: playlist?.title || 'Playlist YouTube',
    trackCount: tracks.length,
  });
  return {
    title: playlist?.title || 'Playlist YouTube',
    tracks,
  };
}

async function buildSeedVideoFallbackPlaylist(seedVideoId) {
  const url = `https://www.youtube.com/watch?v=${seedVideoId}`;
  const notice = 'Playlist này là Mix/Radio của YouTube, bot không thể lấy toàn bộ danh sách nên đã chuyển sang bài gốc.';

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
      error: summarizeProviderError(error),
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
    return new Error('Playlist YouTube này không hỗ trợ trích xuất đầy đủ (thường là Mix/Radio). Hãy gửi liên kết video hoặc playlist thường.');
  }
  return new Error('Không lấy được bài hát từ playlist YouTube này.');
}

async function fetchYoutubePlaylistTracks(playlistUrl) {
  const { canonical, seedVideoId } = parseYoutubePlaylistInput(playlistUrl);
  assertYoutubeAccessAvailable();
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
    const accessBlockedError = openYoutubeAccessCircuit(error, 'yt-dlp');
    lastError = error;
    sawUnviewableError = sawUnviewableError || isUnviewablePlaylistError(error);
    logger.warn('yt-dlp playlist fetch failed; falling back to play-dl.', {
      canonical,
      fallbackTo: accessBlockedError ? null : 'play-dl',
      sawUnviewableError,
      error: summarizeProviderError(error),
    });
    if (accessBlockedError) throw accessBlockedError;
  }

  try {
    return await fetchYoutubePlaylistTracksWithPlayDl(canonical);
  } catch (error) {
    const accessBlockedError = openYoutubeAccessCircuit(error, 'play-dl');
    lastError = error;
    sawUnviewableError = sawUnviewableError || isUnviewablePlaylistError(error);
    logger.warn('play-dl playlist fetch failed.', {
      canonical,
      sawUnviewableError,
      seedVideoId,
      error: summarizeProviderError(error),
    });
    if (accessBlockedError) throw accessBlockedError;
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
    error: summarizeProviderError(lastError),
  });
  throw buildPlaylistFetchError(lastError, sawUnviewableError);
}

module.exports = {
  classifyPlayInput,
  createYoutubeAudioResource,
  fetchYoutubePlaylistTracks,
  getVideoMetadata,
  normalizePlayableUrl,
  searchYoutubeVideo,
};
