
# Examples

This directory is used for demonstrating how a client application may use trimerge-sync to create a real-time collaborative multiplayer application.

# TrimergeSync Basic Server

This implements a simple WebSocket server which maintains a map of "Live Documents". Clients can open websocket connections to the server, get the full history of commits and publish new deltas to the document. These will be persisted in a SQLite DB.

# trimerge-sync-basic-client

The `trimerge-sync-basic-client` package just provides a `WebsocketRemote` class that can be used to connect to the server provided by `trimerge-sync-basic-server`.

# trimerge-sync-example-broadcast-channel

This is a UI layer on top of `trimerge-sync-basic-client` which constructs a fully-fledged TrimergeClient. which persists its commits locally using `trimerge-sync-indexed-db` and uses the `WebsocketRemote` from `trimerge-sync-basic-client` to sync its commits to a running instance of the `trimerge-sync-basic-server`.