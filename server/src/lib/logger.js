/**
 * Structured logger for AI Voice Assistant backend
 */
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const currentLevel = process.env.LOG_LEVEL
  ? LOG_LEVELS[process.env.LOG_LEVEL.toUpperCase()] ?? LOG_LEVELS.INFO
  : LOG_LEVELS.INFO;

function formatMessage(level, message, meta) {
  const timestamp = new Date().toISOString();
  const metaString = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level}] ${message}${metaString}`;
}

export const logger = {
  debug(message, meta) {
    if (currentLevel <= LOG_LEVELS.DEBUG) {
      console.debug(formatMessage('DEBUG', message, meta));
    }
  },
  info(message, meta) {
    if (currentLevel <= LOG_LEVELS.INFO) {
      console.log(formatMessage('INFO', message, meta));
    }
  },
  warn(message, meta) {
    if (currentLevel <= LOG_LEVELS.WARN) {
      console.warn(formatMessage('WARN', message, meta));
    }
  },
  error(message, errorOrMeta) {
    if (currentLevel <= LOG_LEVELS.ERROR) {
      let meta = errorOrMeta;
      if (errorOrMeta instanceof Error) {
        meta = {
          name: errorOrMeta.name,
          message: errorOrMeta.message,
          stack: errorOrMeta.stack,
        };
      }
      console.error(formatMessage('ERROR', message, meta));
    }
  },
};
