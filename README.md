# Trimerge Sync

[![Actions Status](https://github.com/marcello3d/trimerge-sync/workflows/Node%20CI/badge.svg)](https://github.com/marcello3d/trimerge-sync/actions)
[![npm version](https://badge.fury.io/js/trimerge-sync.svg)](https://badge.fury.io/js/trimerge-sync)
[![codecov](https://codecov.io/gh/marcello3d/trimerge-sync/branch/master/graph/badge.svg)](https://codecov.io/gh/marcello3d/trimerge-sync)

## Background

This library is an attempt to describe and implement synchronization using the [trimerge](https://github.com/marcello3d/trimerge/) algorithm. 
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



## License

Zlib license
