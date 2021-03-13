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

### Local events

| event                       | on **Client**                                                                      | on **leader**                                         |
| --------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| local open                  | broadcast `cursor-join` to `local`                                                 | broadcast `cursor-join` to `remote`                   |
| doc edit                    | set `localSaveState` to `pending`, queue in save buffer                            | do nothing                                            |
| save buffer timeout         | set `localSaveState` to `saving`, add to local store, broadcast `nodes` to `local` | broadcast `nodes` to `remote`                         |
| cursor update               | broadcast `cursor-update` to `local`                                               | broadcast `cursor-update` to `remote`                 |
| local close                 | broadcast `cursor-leave` to `local`                                                | broadcast `cursor-leave` to `remote`                  |
| receive `nodes`             | add nodes to state                                                                 | broadcast `nodes` to `remote`                         |
| receive `cursor-join`       | add cursor to list, broadcast `cursor-here` to local                               | broadcast `cursor-join` and `cursor-here` to `remote` |
| receive `cursor-update`     | update cursor on list                                                              | broadcast to `remote`                                 |
| receive `cursor-here`       | update cursor on list                                                              | broadcast to `remote`                                 |
| receive `cursor-leave`      | remote cursor from list                                                            | broadcast to `remote`                                 |
| receive `ack`               | do nothing                                                                         | do nothing                                            |
| receive `ready`             | set `localSaveState` to `ready`                                                    | do nothing                                            |
| receive `remote-connect`    | set `remoteReadState` to `connecting`                                              | do nothing                                            |
| receive `remote-disconnect` | set `remoteReadState` to `offline`, remove remote cursors                          | do nothing                                            |
| receive `error`             | ???                                                                                | do nothing                                            |

### Remote events

| event                              | on **leader Client** (connected to **Remote**)                               |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| connect to remote                  | set `remoteReadState` to `connecting`, broadcast `remote-connect` to `local` |
| disconnect to remote               | set `remoteReadState` to `offline`, broadcast `remote-disconnect` to `local` |
| receive remote `nodes`             | add to local store with `syncId`, broadcast to `local`                       |
| receive remote `ready`             | set `remoteReadState` to `ready`, update local store with `syncId`           |
| receive remote `cursor-join`       | broadcast to `local`, add `remote` cursor origin                             |
| receive remote `cursor-update`     | broadcast to `local`, add `remote` cursor origin                             |
| receive remote `cursor-here`       | broadcast to `local`, add `remote` cursor origin                             |
| receive remote `cursor-leave`      | broadcast to `local`                                                         |
| receive remote `ack`               | update local store with `syncId`                                             |
| receive remote `remote-connect`    | Error                                                                        |
| receive remote `remote-disconnect` | Error                                                                        |
| receive remote `error`             | disconnect/reconnect if fatal error                                          |
