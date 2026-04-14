const fs = require('node:fs');
const path = require('node:path');

const PLAYLISTS_FILE = path.join(process.cwd(), 'playlists.json');
const MAX_PLAYLISTS_PER_USER = 20;
const MAX_TRACKS_PER_PLAYLIST = 200;
const MAX_PLAYLIST_NAME_LENGTH = 24;

function loadStore() {
  try {
    if (!fs.existsSync(PLAYLISTS_FILE)) return { users: {} };
    const parsed = JSON.parse(fs.readFileSync(PLAYLISTS_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.users || typeof parsed.users !== 'object') {
      return { users: {} };
    }
    return parsed;
  } catch {
    return { users: {} };
  }
}

const store = loadStore();

function saveStore() {
  fs.writeFileSync(PLAYLISTS_FILE, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function normalizePlaylistName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function playlistKey(name) {
  return normalizePlaylistName(name).toLowerCase();
}

function assertPlaylistName(name) {
  const normalized = normalizePlaylistName(name);
  if (!normalized) throw new Error('Ten playlist khong duoc de trong.');
  if (normalized.length > MAX_PLAYLIST_NAME_LENGTH) {
    throw new Error(`Ten playlist toi da ${MAX_PLAYLIST_NAME_LENGTH} ky tu.`);
  }
  if (!/^[\w\s-]+$/u.test(normalized)) {
    throw new Error('Ten playlist chi duoc dung chu, so, dau cach, dau gach ngang/gach duoi.');
  }
  return normalized;
}

function getUserPlaylistMap(userId, createIfMissing = false) {
  if (!store.users[userId] && createIfMissing) {
    store.users[userId] = { playlists: {} };
  }
  return store.users[userId]?.playlists || {};
}

function listUserPlaylists(userId) {
  return Object.values(getUserPlaylistMap(userId)).sort((a, b) => a.name.localeCompare(b.name));
}

function getPlaylistByName(userId, name) {
  return getUserPlaylistMap(userId)[playlistKey(name)] || null;
}

function getPlaylistByKey(userId, key) {
  return getUserPlaylistMap(userId)[key] || null;
}

function createPlaylist(userId, name) {
  const normalized = assertPlaylistName(name);
  const key = playlistKey(normalized);
  const map = getUserPlaylistMap(userId, true);

  if (map[key]) throw new Error('Playlist da ton tai.');
  if (Object.keys(map).length >= MAX_PLAYLISTS_PER_USER) {
    throw new Error(`Moi user toi da ${MAX_PLAYLISTS_PER_USER} playlist.`);
  }

  map[key] = {
    key,
    name: normalized,
    createdAt: Date.now(),
    tracks: [],
  };
  saveStore();
  return map[key];
}

function deletePlaylist(userId, nameOrKey) {
  const map = getUserPlaylistMap(userId);
  const key = map[nameOrKey] ? nameOrKey : playlistKey(nameOrKey);
  if (!map[key]) throw new Error('Khong tim thay playlist.');
  delete map[key];
  saveStore();
}

function renamePlaylist(userId, oldName, newName) {
  const oldKey = playlistKey(oldName);
  const map = getUserPlaylistMap(userId);
  const playlist = map[oldKey];
  if (!playlist) throw new Error('Khong tim thay playlist can doi ten.');

  const normalizedNew = assertPlaylistName(newName);
  const newKey = playlistKey(normalizedNew);
  if (oldKey !== newKey && map[newKey]) throw new Error('Ten moi da ton tai.');

  delete map[oldKey];
  playlist.key = newKey;
  playlist.name = normalizedNew;
  map[newKey] = playlist;
  saveStore();
  return playlist;
}

function addTrackToPlaylist(userId, playlistNameOrKey, track) {
  const map = getUserPlaylistMap(userId);
  const key = map[playlistNameOrKey] ? playlistNameOrKey : playlistKey(playlistNameOrKey);
  const playlist = map[key];
  if (!playlist) throw new Error('Khong tim thay playlist.');
  if (playlist.tracks.length >= MAX_TRACKS_PER_PLAYLIST) {
    throw new Error(`Playlist toi da ${MAX_TRACKS_PER_PLAYLIST} bai.`);
  }

  playlist.tracks.push({
    url: track.url,
    title: track.title,
    durationSec: track.durationSec || 0,
    thumbnail: track.thumbnail || null,
    addedAt: Date.now(),
  });
  saveStore();
  return playlist;
}

function addTracksToPlaylist(userId, playlistNameOrKey, tracks) {
  const map = getUserPlaylistMap(userId);
  const key = map[playlistNameOrKey] ? playlistNameOrKey : playlistKey(playlistNameOrKey);
  const playlist = map[key];
  if (!playlist) throw new Error('Khong tim thay playlist.');

  const list = Array.isArray(tracks) ? tracks : [];
  if (playlist.tracks.length + list.length > MAX_TRACKS_PER_PLAYLIST) {
    throw new Error(`Playlist toi da ${MAX_TRACKS_PER_PLAYLIST} bai.`);
  }

  for (const track of list) {
    playlist.tracks.push({
      url: track.url,
      title: track.title,
      durationSec: track.durationSec || 0,
      thumbnail: track.thumbnail || null,
      addedAt: Date.now(),
    });
  }

  saveStore();
  return playlist;
}

function replacePlaylistTracks(userId, playlistNameOrKey, tracks) {
  const map = getUserPlaylistMap(userId);
  const key = map[playlistNameOrKey] ? playlistNameOrKey : playlistKey(playlistNameOrKey);
  const playlist = map[key];
  if (!playlist) throw new Error('Khong tim thay playlist.');

  const list = Array.isArray(tracks) ? tracks : [];
  if (list.length > MAX_TRACKS_PER_PLAYLIST) {
    throw new Error(`Playlist toi da ${MAX_TRACKS_PER_PLAYLIST} bai.`);
  }

  playlist.tracks = list.map((track) => ({
    url: track.url,
    title: track.title,
    durationSec: track.durationSec || 0,
    thumbnail: track.thumbnail || null,
    addedAt: Date.now(),
  }));

  saveStore();
  return playlist;
}

function removeTrackByIndex(userId, playlistNameOrKey, oneBasedIndex) {
  const map = getUserPlaylistMap(userId);
  const key = map[playlistNameOrKey] ? playlistNameOrKey : playlistKey(playlistNameOrKey);
  const playlist = map[key];
  if (!playlist) throw new Error('Khong tim thay playlist.');

  const index = Number(oneBasedIndex) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= playlist.tracks.length) {
    throw new Error('Index bai hat khong hop le.');
  }

  const [removed] = playlist.tracks.splice(index, 1);
  saveStore();
  return removed;
}

function removeLastTrack(userId, playlistNameOrKey) {
  const map = getUserPlaylistMap(userId);
  const key = map[playlistNameOrKey] ? playlistNameOrKey : playlistKey(playlistNameOrKey);
  const playlist = map[key];
  if (!playlist) throw new Error('Khong tim thay playlist.');
  if (playlist.tracks.length === 0) throw new Error('Playlist dang trong.');

  const removed = playlist.tracks.pop();
  saveStore();
  return removed;
}

module.exports = {
  MAX_TRACKS_PER_PLAYLIST,
  addTrackToPlaylist,
  addTracksToPlaylist,
  createPlaylist,
  deletePlaylist,
  getPlaylistByKey,
  getPlaylistByName,
  getUserPlaylistMap,
  listUserPlaylists,
  normalizePlaylistName,
  playlistKey,
  removeLastTrack,
  removeTrackByIndex,
  replacePlaylistTracks,
  renamePlaylist,
};
