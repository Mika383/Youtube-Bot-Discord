function formatDuration(seconds) {
  const safe = Math.max(0, Number.isFinite(seconds) ? Math.floor(seconds) : 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function truncateLabel(text, max = 100) {
  const raw = String(text || '');
  return raw.length > max ? `${raw.slice(0, max - 1)}...` : raw;
}

function truncateText(text, max = 1000) {
  const raw = String(text || '');
  if (raw.length <= max) return raw;
  if (max <= 1) return raw.slice(0, max);
  return `${raw.slice(0, max - 1)}…`;
}

module.exports = {
  formatDuration,
  truncateLabel,
  truncateText,
};
