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
      timestamp: Date.now(),
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
      timestamp: Date.now(),
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
      timestamp: Date.now(),
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
      timestamp: Date.now(),
    });
  }
  error(...args: unknown[]): void {
    this._events.push({
      type: 'log-message',
      sourceId: 'unknown',
      payload: {
        level: 'error',
        message: args,
      },
      timestamp: Date.now(),
    });
  }
  event(event: LoggerEvent): void {
    this._events.push({ timestamp: Date.now(), ...event });
  }
}
