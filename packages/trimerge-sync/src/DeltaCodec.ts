export interface DeltaCodec<Delta, SerializedDelta> {
  encode(delta: Delta | undefined): SerializedDelta;
  decode(delta: SerializedDelta | undefined): Delta | undefined;
}

const NOOP_DELTA = 'NOOP';

export const JSON_DELTA_CODEC: DeltaCodec<unknown, string> = {
  encode(delta: unknown | undefined): string {
    return JSON.stringify(delta) ?? NOOP_DELTA;
  },
  decode(delta: string | undefined): unknown | undefined {
    if (delta === undefined) {
      throw new Error('invalid delta');
    }
    if (delta === NOOP_DELTA) {
      return undefined;
    }
    return JSON.parse(delta);
  },
};

export function getNoopDeltaCodec<T>(): DeltaCodec<T, T> {
  return {
    encode(delta: T): T {
      return delta;
    },
    decode(delta: T): T {
      return delta;
    },
  };
}
