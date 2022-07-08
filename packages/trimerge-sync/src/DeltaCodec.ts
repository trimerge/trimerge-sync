export interface DeltaCodec<Delta, SerializedDelta> {
  encode(delta: Delta | undefined): SerializedDelta;
  decode(delta: SerializedDelta | undefined): Delta | undefined;
}

const NOOP_DELTA = 'NOOP';

export const JSON_DELTA_CODEC: DeltaCodec<any, string> = {
  encode(delta: any | undefined): string {
    return JSON.stringify(delta) ?? NOOP_DELTA;
  },
  decode(delta: string | undefined): any | undefined {
    if (delta === undefined) {
      throw new Error('invalid delta');
    }
    if (delta === NOOP_DELTA) {
      return undefined;
    }
    return JSON.parse(delta);
  },
};
