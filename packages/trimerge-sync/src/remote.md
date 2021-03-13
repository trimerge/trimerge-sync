# Remote Sync

The main idea is there is a single set of events used both for local sync (between browser windows/tabs) and remote. There are three layers (let's call them Client, Device, and Remote):

- **Client:** In-memory TrimergeClient, it connects to a local store
- **Device:** A local store is in charge of communicating between all clients (browser tabs), and persisting data. I'm using a BroadcastChannel to communicate between tabs and IndexedDb to save to disk (in unit tests this is just stored in memory) (Device)
- **Remote:** Additionally a local store can connect to a "remote" store to sync itself to other (this has the same interface as a local store, but the usage is different)

**Remote**s are setup by maintaining leader among all the **Client** instances (on a **Device**) that connects to a single **Remote**.

## Operations:

A user directly interacts with a single **Client**, there are 4 main operations:

- **connect**: e.g. start editing the document
- **edit**: change the document state
- **cursor update**: change the cursor state (e.g. selection or focus)
- **disconnect**: stop editing the document

## Events:

- `nodes`: new nodes (and possibly a cursor)
- `ack`: `nodes` were received and saved to store
- `ready`: sent once on connect after `nodes`
- `cursor-join`: client connects
- `cursor-here`: response to a `cursor-join`
- `cursor-update`: update to cursor (e.g. changing focus/selection)
- `cursor-leave`: user leaves
- `remote-connect`: connected to remote store
- `remote-disconnect`: disconnected from remote store
- `error`: error with store/message sent

## Sync Status:

- `localReadState`:
  - `loading`: reading state from disk
  - `ready`: have latest state from disk, receiving local changes
- `localSaveState`:
  - `ready`: no changes in local memory
  - `pending`: changes in local memory, not sent to store yet
  - `saving`: sent changes to local store, no `ack` yet
- `remoteReadState`:
  - `offline`: no connection to server
  - `connecting`: connecting to server
  - `loading`: connected and downloading initial nodes to get in sync
  - `ready`: all state synced from remote, receiving live updates
- `remoteSaveState`:
  - `ready`: all local state has been synced to remote (though maybe local changes in memory)
  - `pending`: we have local state that hasn't been sent to remote yet (maybe offline)
  - `saving`: we sent local state to remote, but haven't got `ack` yet

## Event handling:

| event                              | on **Client**                                             | on **leader** (connected to **Remote**)                                      |
| ---------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| local edit                         | add to local store, broadcast `nodes` to `local`          | and `remote`                                                                 |
| local cursor update                | broadcast `cursor-update` to `local`                      | and `remote`                                                                 |
| local connect                      | broadcast `cursor-join` to `local`                        | and `remote`                                                                 |
| local disconnect                   | broadcast `cursor-leave` to `local`                       | and `remote`                                                                 |
| connect to remote                  | n/a                                                       | set `remoteReadState` to `connecting`, broadcast `remote-connect` to `local` |
| disconnect to remote               | n/a                                                       | set `remoteReadState` to `offline`, broadcast `remote-disconnect` to `local` |
| receive local `nodes`              | add nodes to state                                        | broadcast to `remote`                                                        |
| receive local `cursor-join`        | add cursor to list, broadcast `cursor-here` to local      | broadcast `cursor-join` and `cursor-here` to `remote`                        |
| receive local `cursor-update`      | update cursor on list                                     | broadcast to `remote`                                                        |
| receive local `cursor-here`        | update cursor on list                                     | broadcast to `remote`                                                        |
| receive local `cursor-leave`       | remote cursor from list                                   | broadcast to `remote`                                                        |
| receive local `ack`                | do nothing                                                | do nothing                                                                   |
| receive local `ready`              | set `localSaveState` to `ready`                           | do nothing                                                                   |
| receive local `remote-connect`     | set `remoteReadState` to `connecting`                     | do nothing                                                                   |
| receive local `remote-disconnect`  | set `remoteReadState` to `offline`, remove remote cursors | do nothing                                                                   |
| receive local `error`              | ???                                                       | do nothing                                                                   |
| receive remote `nodes`             | n/a                                                       | add to local store with `syncId`, broadcast to `local`                       |
| receive remote `cursor-join`       | n/a                                                       | broadcast to `local`, add `remote` cursor origin                             |
| receive remote `cursor-update`     | n/a                                                       | broadcast to `local`, add `remote` cursor origin                             |
| receive remote `cursor-here`       | n/a                                                       | broadcast to `local`, add `remote` cursor origin                             |
| receive remote `cursor-leave`      | n/a                                                       | broadcast to `local`                                                         |
| receive remote `ack`               | n/a                                                       | update local store with `syncId`                                             |
| receive remote `ready`             | set `localSaveState` to `ready`                           | set `remoteReadState` to `ready`, update local store with `syncId`           |
| receive remote `remote-connect`    | n/a                                                       | Error                                                                        |
| receive remote `remote-disconnect` | n/a                                                       | Error                                                                        |
| receive remote `error`             | n/a                                                       | disconnect/reconnect if fatal error                                          |
