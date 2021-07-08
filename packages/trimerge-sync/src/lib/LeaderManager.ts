import { LeaderEvent } from '../types';
import { getSortedMin } from './Iterables';

type Timeout = ReturnType<typeof setTimeout>;
type Interval = ReturnType<typeof setInterval>;

export type LeaderSettings = Readonly<{
  electionTimeoutMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
}>;

const DEFAULT_SETTINGS: LeaderSettings = {
  electionTimeoutMs: 1_000,
  heartbeatIntervalMs: 2_000,
  heartbeatTimeoutMs: 5_000,
};

/**
 * This class takes a best-effort approach to picking a single leader amongst
 * multiple clients assuming a shared broadcast channel.
 *
 * Whenever a client comes online, it requests an election.
 *
 * 1. If there is already a leader, it will announce itself, cancelling the election.
 * 2. Otherwise, everyone announces themselves as available.
 *
 * After an election timeout, the client with the alphanumerically smallest
 * clientId announces itself as the leader to everyone.
 *
 * If a leader receives an announcement from another leader, a re-election will
 * occur, and all but one of them will be demoted back to non-leader.
 */
export class LeaderManager {
  private closed = false;
  private currentLeaderId?: string = undefined;
  private isLeader: boolean = false;
  private potentialLeaders = new Set<string>();
  private electionTimeout?: Timeout = undefined;
  private leaderHeartbeat?: Interval = undefined;
  private heartbeatTimeout?: Timeout = undefined;

  constructor(
    /**
     * A unique identifier for each client. This can simply be a uuid
     */
    private readonly clientId: string,
    /**
     * A callback for when this client gains or loses leadership
     */
    private readonly onLeaderChange: (isLeader: boolean) => void,
    /**
     * A callback for when this class needs to broadcast messages to other clients
     */
    private readonly broadcastEvent: (event: LeaderEvent) => void,
    private readonly settings: LeaderSettings = DEFAULT_SETTINGS,
  ) {
    this.elect();
  }

  private elect() {
    if (this.electionTimeout) {
      return;
    }
    this.potentialLeaders.clear();
    this.potentialLeaders.add(this.clientId);
    this.broadcastEvent({
      type: 'leader',
      action: 'request',
      clientId: this.clientId,
    });
    this.electionTimeout = setTimeout(
      () => this.finishElection(),
      this.settings.electionTimeoutMs,
    );
  }

  private cancelElection() {
    if (this.electionTimeout) {
      clearTimeout(this.electionTimeout);
      this.electionTimeout = undefined;
    }
  }
  private finishElection() {
    this.electionTimeout = undefined;
    console.log(`[LEADER] election over…`, Array.from(this.potentialLeaders));
    this.setLeader(getSortedMin(this.potentialLeaders));
  }

  private setLeader(leaderId: string | undefined) {
    this.cancelElection();
    const { clientId } = this;
    const isLeader = leaderId === clientId;
    if (leaderId !== this.currentLeaderId) {
      this.currentLeaderId = leaderId;
    }
    if (this.isLeader !== isLeader) {
      this.isLeader = isLeader;
      this.onLeaderChange(isLeader);
      if (this.leaderHeartbeat) {
        clearInterval(this.leaderHeartbeat);
        this.leaderHeartbeat = undefined;
      }
      if (isLeader) {
        this.broadcastEvent({ type: 'leader', action: 'current', clientId });
        this.leaderHeartbeat = setInterval(
          () => this.onLeaderHeartbeat(),
          this.settings.heartbeatIntervalMs,
        );
      }
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = undefined;
    }
    if (!isLeader) {
      this.heartbeatTimeout = setTimeout(
        () => this.onHeartbeatTimeout(),
        this.settings.heartbeatTimeoutMs,
      );
    }
  }

  private onLeaderHeartbeat() {
    const { clientId } = this;
    this.broadcastEvent({ type: 'leader', action: 'current', clientId });
  }
  private onHeartbeatTimeout() {
    this.heartbeatTimeout = undefined;
    console.warn(`[TRIMERGE-SYNC] leader timeout`);
    this.elect();
  }

  receiveEvent({ action, clientId: otherClientId }: LeaderEvent) {
    const { currentLeaderId, clientId, closed } = this;
    if (closed) {
      return;
    }
    switch (action) {
      case 'request':
        if (currentLeaderId === undefined) {
          // An election is needed
          this.elect();
          this.potentialLeaders.add(otherClientId);
          this.broadcastEvent({
            type: 'leader',
            action: 'accept',
            clientId,
          });
        } else if (currentLeaderId === clientId) {
          // We already are the leader
          this.broadcastEvent({
            type: 'leader',
            action: 'current',
            clientId,
          });
        }
        break;
      case 'current':
        if (this.isLeader) {
          // This will happen if there's a disconnect/messages are delayed
          if (otherClientId < clientId) {
            this.setLeader(undefined);
          }
          console.warn(`[TRIMERGE-SYNC] multiple leaders detected`);
          this.elect();
        } else {
          this.setLeader(otherClientId);
        }
        break;
      case 'accept':
        this.potentialLeaders.add(otherClientId);
        break;
      case 'withdraw':
        if (otherClientId === this.currentLeaderId) {
          this.setLeader(undefined);
          this.elect();
        } else {
          this.potentialLeaders.delete(otherClientId);
        }
        break;
    }
  }

  close(cleanShutdown: boolean = true) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.cancelElection();
    if (cleanShutdown) {
      this.broadcastEvent({
        type: 'leader',
        action: 'withdraw',
        clientId: this.clientId,
      });
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = undefined;
    }
    if (this.leaderHeartbeat) {
      clearInterval(this.leaderHeartbeat);
      this.leaderHeartbeat = undefined;
    }
  }
}
