export type Authenticated = { userId: string; readonly: boolean };
export type AuthenticateFn = (
  docId: string,
  auth: unknown,
) => Promise<Authenticated>;
export type LogParams = Record<string, number | string | undefined | null>;
export type LogFn = (message: string, params?: LogParams) => void;

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
}
