import { Logger, LoggerEvent } from '../types';

/** Test logging utility that's useful for debugging. */
export class MemoryLogger implements Logger {
    readonly _logs: unknown[] = [];
    readonly _events: LoggerEvent[] = [];
    log(...args: unknown[]): void {
        this._logs.push(args);
    }
    debug(...args: unknown[]): void {
        this._logs.push(args);
    }
    info(...args: unknown[]): void {
        this._logs.push(args);
    }
    warn(...args: unknown[]): void {
        this._logs.push(args);
    }
    error(...args: unknown[]): void {
        this._logs.push(args);
    }
    event(event: LoggerEvent): void {
        this._events.push(event);
    }
}
