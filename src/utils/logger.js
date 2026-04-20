'use strict';

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = String(process.env.LOG_LEVEL || 'debug').toLowerCase();
const minLevel = LEVELS[configuredLevel] || LEVELS.debug;

function truncateString(value, maxLength = 4000) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...<truncated>`;
}

function serializeError(error) {
  if (!error) return null;
  if (!(error instanceof Error)) {
    if (typeof error === 'object') return sanitizeMeta(error);
    return truncateString(error);
  }

  return {
    name: error.name,
    message: error.message,
    code: error.code,
    errno: error.errno,
    type: error.type,
    status: error.status,
    statusCode: error.statusCode,
    signal: error.signal,
    exitCode: error.exitCode,
    shortMessage: error.shortMessage,
    stdout: error.stdout ? truncateString(error.stdout) : undefined,
    stderr: error.stderr ? truncateString(error.stderr) : undefined,
    stack: error.stack ? truncateString(error.stack, 12000) : undefined,
  };
}

function sanitizeMeta(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return serializeError(value);

  const type = typeof value;
  if (type === 'string') return truncateString(value);
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'bigint') return String(value);
  if (type === 'function') return `[Function ${value.name || 'anonymous'}]`;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMeta(item, seen));
  }

  if (type === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = sanitizeMeta(entry, seen);
    }

    seen.delete(value);
    return output;
  }

  return truncateString(value);
}

function writeLog(scope, level, message, meta) {
  if ((LEVELS[level] || LEVELS.info) < minLevel) return;

  const prefix = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}`;
  if (meta === undefined) {
    const printer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    printer(prefix);
    return;
  }

  const serialized = JSON.stringify(sanitizeMeta(meta));
  const line = `${prefix} ${serialized}`;
  const printer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  printer(line);
}

function createLogger(scope) {
  return {
    debug(message, meta) {
      writeLog(scope, 'debug', message, meta);
    },
    info(message, meta) {
      writeLog(scope, 'info', message, meta);
    },
    warn(message, meta) {
      writeLog(scope, 'warn', message, meta);
    },
    error(message, meta) {
      writeLog(scope, 'error', message, meta);
    },
  };
}

module.exports = {
  createLogger,
  sanitizeMeta,
  serializeError,
};
