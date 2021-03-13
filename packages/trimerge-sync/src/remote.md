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

## Event handling:

| event                      | on **Client**                                    | on **leader** (connected to **Remote**)                |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| local edit                 | add to local store, broadcast `nodes` to `local` | and `remote`                                           |
| local cursor update        | broadcast `cursor-update` to `local`             | and `remote`                                           |
| local connect              | broadcast `cursor-join` to `local`               | and `remote`                                           |
| local disconnect           | broadcast `cursor-leave` to `local`              | and `remote`                                           |
| connect to remote          | n/a                                              | broadcast `remote-connect` to `local`                  |
| disconnect to remote       | n/a                                              | broadcast `remote-disconnect` to `local`               |
| local `nodes`              | add nodes to state                               | broadcast to `remote`                                  |
| local `cursor-join`        | add cursor to list                               | broadcast to `remote`                                  |
| local `cursor-update`      | update cursor on list                            | broadcast to `remote`                                  |
| local `cursor-here`        | update cursor on list                            | broadcast to `remote`                                  |
| local `cursor-leave`       | remote cursor from list                          | broadcast to `remote`                                  |
| local `ack`                | do nothing                                       | do nothing                                             |
| local `remote-connect`     | show online status                               | do nothing                                             |
| local `remote-disconnect`  | show offline status, remove remote cursors       | do nothing                                             |
| local `error`              | ???                                              | do nothing                                             |
| remote `nodes`             | n/a                                              | add to local store with `syncId`, broadcast to `local` |
| remote `cursor-join`       | n/a                                              | broadcast to `local`, add `remote` cursor origin       |
| remote `cursor-update`     | n/a                                              | broadcast to `local`, add `remote` cursor origin       |
| remote `cursor-here`       | n/a                                              | broadcast to `local`, add `remote` cursor origin       |
| remote `cursor-leave`      | n/a                                              | broadcast to `local`                                   |
| remote `ack`               | n/a                                              | update local store with `syncId`                       |
| remote `remote-connect`    | n/a                                              | Error                                                  |
| remote `remote-disconnect` | n/a                                              | Error                                                  |
| remote `error`             | n/a                                              | disconnect/reconnect if fatal error                    |
