import { Logger, LoggerEvent } from '../types';

/** Utility that applies a prefix to log messages. If provided with a Prefix logger, it will concatenate the prefixes. */
export class PrefixLogger implements Logger {
  readonly prefix: string;
  readonly logger: Logger;
  constructor(prefix: string, logger: Logger) {
    if (logger instanceof PrefixLogger) {
      this.prefix = `${logger.prefix}/${prefix}`;
      this.logger = logger.logger;
    } else {
      this.prefix = prefix;
      this.logger = logger;
    }
  }

  debug(...args: any[]) {
    this.logger.event?.({
      type: 'log-message',
      sourceId: this.prefix,
      payload: {
        level: 'debug',
        message: args,
      },
    });
  }

  log(...args: any[]) {
    this.logger.event?.({
      type: 'log-message',
      sourceId: this.prefix,
      payload: {
        level: 'info',
        message: args,
      },
    });
  }

  info(...args: any[]) {
    this.logger.event?.({
      type: 'log-message',
      sourceId: this.prefix,
      payload: {
        level: 'info',
        message: args,
      },
    });
  }

  warn(...args: any[]) {
    this.logger.event?.({
      type: 'log-message',
      sourceId: this.prefix,
      payload: {
        level: 'warn',
        message: args,
      },
    });
  }

  error(...args: any[]) {
    this.logger.event?.({
      type: 'log-message',
      sourceId: this.prefix,
      payload: {
        level: 'error',
        message: args,
      },
    });
  }

  event(event: LoggerEvent) {
    this.logger.event?.(event);
  }
}
