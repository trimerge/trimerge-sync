# Trimerge Sync

[![Actions Status](https://github.com/marcello3d/trimerge-sync/workflows/Node%20CI/badge.svg)](https://github.com/marcello3d/trimerge-sync/actions)
[![npm version](https://badge.fury.io/js/trimerge-sync.svg)](https://badge.fury.io/js/trimerge-sync)
[![codecov](https://codecov.io/gh/marcello3d/trimerge-sync/branch/master/graph/badge.svg)](https://codecov.io/gh/marcello3d/trimerge-sync)

## Background

This WIP library intends to implement synchronization using the [trimerge](https://github.com/marcello3d/trimerge/) algorithm.
It is an iteration on top of my original [collabodux](https://github.com/marcello3d/collabodux) proof-of-concept.

Trimerge-sync is a client-first declarative/functional approach to synchronizing application state across devices/users.

It “steals” ideas from a number of projects:

- The entire state is represented as an immutable data structure (as in [Redux](https://redux.js.org))
- Each change is represented by a base revision and new revision (as in Git)
- Changes are applied by diffing data structures (as in [React](https://reactjs.org) virtual dom)
- Conflicts are resolved on the client side (as in [@mweststrate](https://github.com/mweststrate)'s
  “[Distributing state changes using snapshots, patches and actions](https://medium.com/@mweststrate/distributing-state-changes-using-snapshots-patches-and-actions-part-2-2f50d8363988)”)
- Data structure design can limit conflicts (as in [CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type))

### What makes it good:

- Easy to reason about application state because it's just immutable JS objects
  - Unlike CRDT, which requires you to use custom data structures
  - Works with existing tools like [Redux](https://redux.js.org) and
    [Immer.js](https://github.com/mweststrate/immer)
- Conflict resolution is data-oriented and declarative
  - Unlike Operational Transform, which becomes increasingly more complex with more types of operations
  - Scales with data type complexity, not schema size
  - Easy to write unit tests against
- Offline-first
- Integrated multi-user undo
  - Can easily rollback specific edits
  - Can capture undo state
- Server or peer-to-peer (theoretically)
- Server is schema-agnostic
  - Focused on networking, authentication, and persistence

### Limitations:

- Assumes application is built on immutable data structures
- Does not scale to high number of concurrent edits (conflict thrashing)
- Requires the full document model to be in all clients' memory

## Architecture

### Trimerge Graph

The state history is a directed acyclic append-only graph. Each node represents an edit.

All nodes are immutable: you can only add new nodes that point to them.

Each graph node represents an edit with zero, one, or two parents:

0: an initial edit has no parent, generally a blank document
1: a single-parent node is a simple edit
2: a dual-parent node is a merge of the two parents

#### Trimerging Nodes

A node is a "head" node if it has no child nodes (i.e. no nodes that reference it as a parent).

Whenever a client has more than one head node, it attempts to trimerge all the head nodes into one node.

This is done with trimerge:

1. find the two head nodes with the closest common ancestor
2. trimerge those two nodes against their common base
3. create a merge node
4. repeat until there is one head node

### Trimerge Graph Sync

First let's look at the four levels of possible synchronization:

- LEVEL 1: Local process sync
- LEVEL 2: Persisted local process sync
- LEVEL 3: Persisted remote sync
- LEVEL 4: Persisted p2p sync

All levels assume some kind of 2-way communication between processes. This could be broadcast-channel, websockets, or something custom   

#### LEVEL 1: Local process sync

In order to synchronize local processes (e.g. browser tabs or between webworkers), we need the following:

1. Start listening on a shared message channel
2. Make “hello” request to see if anyone is out there
3. Get snapshot from another process, or start new one
4. On local change send diff nodes
5. On receive do send acknowledgment / trimerge as needed
6. On receiving acknowledgement delete old nodes


#### LEVEL 2: Persisted local process sync

This is similar, but assumes all processes can access a central data store (like IndexedDB or Sqlite, etc).



#### other

So how do you synchronize these graphs across clients?

The first thing is to have a simpler version of each node:

1. Only store a diff of a node and its parent (pick one for merges)
2. To avoid reading an entire path of the graph, you can store snapshots at arbitrary nodes

Then you need a way to know when a node should be sent to another client or not. I haven't quite figured out the best way to do this.

## License

Zlib license
