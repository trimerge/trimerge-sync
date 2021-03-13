Events:

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

Client can:

| event                     | on local store                                   | on leader instance                                     |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| local edit                | add to local store, broadcast `nodes` to `local` | and `remote`                                           |
| local cursor update       | broadcast `cursor-update` to `local`             | and `remote`                                           |
| local connect             | broadcast `cursor-join` to `local`               | and `remote`                                           |
| local disconnect          | broadcast `cursor-leave` to `local`              | and `remote`                                           |
| connect to remote         | n/a                                              | broadcast `remote-connect` to `local`                  |
| disconnect to remote      | n/a                                              | broadcast `remote-disconnect` to `local`               |
| local `nodes`             | -                                                | broadcast to `remote`                                  |
| local `cursor-join`       | -                                                | broadcast to `remote`                                  |
| local `cursor-update`     | -                                                | broadcast to `remote`                                  |
| local `cursor-here`       | -                                                | broadcast to `remote`                                  |
| local `cursor-leave`      | -                                                | broadcast to `remote`                                  |
| local `ack`               | -                                                | -                                                      |
| local `remote-disconnect` | remove remote cursors                            | -                                                      |
| remote `nodes`            | n/a                                              | add to local store with `syncId`, broadcast to `local` |
| remote `cursor-join`      | n/a                                              | broadcast to `local`, add `remote` cursor origin       |
| remote `cursor-update`    | n/a                                              | broadcast to `local`, add `remote` cursor origin       |
| remote `cursor-here`      | n/a                                              | broadcast to `local`, add `remote` cursor origin       |
| remote `cursor-leave`     | n/a                                              | broadcast to `local`                                   |
| remote `ack`              | n/a                                              | update local store with `syncId`                       |
