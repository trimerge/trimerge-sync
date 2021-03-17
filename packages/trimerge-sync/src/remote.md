# Remote Sync

The main idea is there is a single set of events used both for local sync (between browser windows/tabs) and remote. There are three layers (let's call them Client, Device, and Remote):

- **Client:** In-memory TrimergeClient, it connects to a local store
- **Device:** A local store is in charge of communicating between all clients (browser tabs), and persisting data. I'm using a BroadcastChannel to communicate between tabs and IndexedDb to save to disk (in unit tests this is just stored in memory) (Device)
- **Remote:** Additionally a local store can connect to a "remote" store to sync itself to other

**Remote**s are setup by maintaining leader among all the **Client** instances (on a **Device**) that connects to a single **Remote**.

## Operations:

A user directly interacts with a single **Client**, there are 4 main operations:

- **connect**: e.g. start editing the document
- **edit**: change the document state
- **presence update**: change the presence state (e.g. selection or focus)
- **disconnect**: stop editing the document

## Events:

- `nodes`: new nodes (and possibly a client state)
- `ack`: `nodes` were received and saved to store
- `ready`: sent once on connect after `nodes`
- `client-join`: client connects
- `client-presence`: response to a `client-join` / update to presence state (e.g. changing focus/selection)
- `client-leave`: user leaves
- `remote-state`: remote state change
- `error`: error with store/message sent

## Sync Status:

- `localReadStatus`:
  - `loading`: reading state from disk
  - `ready`: have latest state from disk, receiving local changes
- `localSaveStatus`:
  - `ready`: no changes in local memory
  - `pending`: changes in local memory, not sent to store yet
  - `saving`: sent changes to local store, no `ack` yet
- `remoteReadStatus`:
  - `offline`: no connection to server
  - `connecting`: connecting to server
  - `loading`: connected and downloading initial nodes to get in sync
  - `ready`: all state synced from remote, receiving live updates
- `remoteSaveStatus`:
  - `ready`: all local state has been synced to remote (though maybe local changes in memory)
  - `pending`: we have local state that hasn't been sent to remote yet (maybe offline)
  - `saving`: we sent local state to remote, but haven't got `ack` yet

## Event handling:

### Local events

| event                     | on **Client**                                                                      | on **leader**                           |
| ------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------- |
| local open                | broadcast `client-join` to `local`                                                 | broadcast `client-join` to `remote`     |
| doc edit                  | set `localSaveState` to `pending`, queue in save buffer                            | do nothing                              |
| save buffer timeout       | set `localSaveState` to `saving`, add to local store, broadcast `nodes` to `local` | broadcast `nodes` to `remote`           |
| presence update           | broadcast `client-presence` to `local`                                             | broadcast `client-presence` to `remote` |
| local close               | broadcast `client-leave` to `local`                                                | broadcast `client-leave` to `remote`    |
| receive `nodes`           | add nodes to state                                                                 | broadcast `nodes` to `remote`           |
| receive `client-join`     | add client to list, broadcast `client-presence` to local                           | broadcast `client-join` `remote`        |
| receive `client-presence` | update client on list                                                              | broadcast to `remote`                   |
| receive `client-leave`    | remote client from list                                                            | broadcast to `remote`                   |
| receive `ack`             | do nothing                                                                         | Error                                   |
| receive `ready`           | set `localSaveState` to `ready`                                                    | do nothing                              |
| receive `remote-state`    | set remote state, if offline, remove remote cursors                                | do nothing                              |
| receive `error`           | ???                                                                                | do nothing                              |

### Remote events

| event                            | on **leader Client** (connected to **Remote**)                                      |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| connect to remote                | set `remoteReadState` to `connecting`, broadcast to `local`                         |
| disconnect to remote             | set `remoteReadState` to `offline`, broadcast to `local`                            |
| receive remote `nodes`           | add to local store with `syncId`, broadcast to `local`                              |
| receive remote `ready`           | set `remoteReadState` to `ready`, broadcast to `local`, update local store `syncId` |
| receive remote `client-join`     | broadcast to `local`, add `remote` cursor origin                                    |
| receive remote `client-presence` | broadcast to `local`, add `remote` cursor origin                                    |
| receive remote `client-leave`    | broadcast to `local`                                                                |
| receive remote `ack`             | update local store with `syncId`                                                    |
| receive remote `remote-state`    | Error                                                                               |
| receive remote `error`           | disconnect/reconnect if fatal error                                                 |
