import { Logger } from '../types';

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
    this.logger.debug(`[${this.prefix}]`, ...args);
  }

  log(...args: any[]) {
    this.logger.log(`[${this.prefix}]`, ...args);
  }

  info(...args: any[]) {
    this.logger.info(`[${this.prefix}]`, ...args);
  }

  warn(...args: any[]) {
    this.logger.warn(`[${this.prefix}]`, ...args);
  }

  error(...args: any[]) {
    this.logger.error(`[${this.prefix}]`, ...args);
  }
}
