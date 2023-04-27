#

## TrimergeClient

`TrimergeClient` is the client-side entry point to trimerge sync. It manages:

- in-memory representation of a single cursor (i.e. viewport)
- provides subscribers to track edits and user presence

It uses a `TrimergeSyncBackend` to connect to a backend

## Syncing with remotes

- Track which nodes are local synced vs remote synced.
-
