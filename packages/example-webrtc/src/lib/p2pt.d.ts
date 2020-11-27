declare module 'p2pt' {
  import EventEmitter from 'events';
  type Stats = {
    connected: number;
    total: number;
  };
  export type Peer = {
    allowHalfOpen: boolean;
    allowHalfTrickle: boolean;
    answerOptions: object;
    channelConfig: object;
    channelName: object;
    channelNegotiated: object;
    config: object;
    id: string;
    localAddress: string;
    localFamily: string;
    localPort: string;
    remoteAddress: string;
    remoteFamily: string;
    remotePort: string;
    on(event: 'connect', callback: () => void): void;
    once(event: 'connect', callback: () => void): void;
  };
  export default class P2PT extends EventEmitter {
    constructor(announceURLs?: string[], identifierString?: string);

    readonly _peerId: string;
    readonly peers: Record<string, Record<string, Peer>>;

    setIdentifier(identifierString: string): void;
    start(): void;
    addTracker(announceURL: string): void;
    removeTracker(announceURL: string): void;
    send(
      peer: Peer,
      msg: any,
      msgID?: string,
    ): Promise<[peer: Peer, message: any]>;
    requestMorePeers(): Promise<any>;
    destroy(): void;
    on(event: 'peer', callback: (peer: Peer) => void): this;
    on(event: 'peerconnect', callback: (peer: Peer) => void): this;
    on(event: 'data', callback: (peer: Peer, data: any) => void): this;
    on(event: 'msg', callback: (peer: Peer, msg: any) => void): this;
    on(event: 'peerclose', callback: (peer: Peer) => void): this;
    on(
      event: 'trackerconnect',
      callback: (websocketTracker: any, stats: Stats) => void,
    ): this;
    on(
      event: 'trackerwarning',
      callback: (error: Error, stats: Stats) => void,
    ): this;
  }
}
