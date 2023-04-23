import { Logger, LoggerEvent } from '../types';

/** Test logging utility that's useful for debugging. */
export class MemoryLogger implements Logger {
  readonly _events: LoggerEvent[] = [];
  log(...args: unknown[]): void {
    this._events.push({
      type: 'log-message',
      sourceId: 'unknown',
      payload: {
        level: 'info',
        message: args,
      },
    });
  }
  debug(...args: unknown[]): void {
    this._events.push({
      type: 'log-message',
      sourceId: 'unknown',
      payload: {
        level: 'debug',
        message: args,
      },
    });
  }
  info(...args: unknown[]): void {
    this._events.push({
      type: 'log-message',
      sourceId: 'unknown',
      payload: {
        level: 'info',
        message: args,
      },
    });
  }
  warn(...args: unknown[]): void {
    this._events.push({
      type: 'log-message',
      sourceId: 'unknown',
      payload: {
        level: 'warn',
        message: args,
      },
    });
  }
  error(...args: unknown[]): void {
    this._logs.push(args);
  }
  event(event: LoggerEvent): void {
    this._events.push(event);
  }
}
