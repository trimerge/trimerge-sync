import { TrimergeGraph } from './trimerge-graph';

let nextId = 1;
function newId(): string {
  return (nextId++).toString();
}
beforeEach(() => {
  nextId = 1;
});

describe('Graph', () => {
  it('add linear edits', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    let node = graph.addInit({}, 'initialize');
    node = graph.addEdit(node, { hello: 'world' }, 'add hello');
    node = graph.addEdit(node, { hello: 'vorld' }, 'change hello');
    node = graph.addEdit(node, {}, 'delete hello');
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "base": Object {
            "base": Object {
              "base": Object {
                "editMetadata": "initialize",
                "ref": "1",
                "value": Object {},
              },
              "editMetadata": "add hello",
              "ref": "2",
              "value": Object {
                "hello": "world",
              },
            },
            "editMetadata": "change hello",
            "ref": "3",
            "value": Object {
              "hello": "vorld",
            },
          },
          "editMetadata": "delete hello",
          "ref": "4",
          "value": Object {},
        },
      }
    `);
  });

  it('add diverging edits', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    let foo = graph.addInit({}, 'initialize');
    foo = graph.addEdit(foo, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    foo = graph.addEdit(foo, {}, 'delete hello');
    let bar = graph.addInit({}, 'initialize');
    bar = graph.addEdit(bar, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    bar = graph.addEdit(bar, {}, 'delete world');
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "base": Object {
            "base": Object {
              "base": Object {
                "editMetadata": "initialize",
                "ref": "1",
                "value": Object {},
              },
              "editMetadata": "add hello",
              "ref": "2",
              "value": Object {
                "hello": "world",
              },
            },
            "editMetadata": "change hello",
            "ref": "3",
            "value": Object {
              "hello": "vorld",
            },
          },
          "editMetadata": "delete hello",
          "ref": "4",
          "value": Object {},
        },
        Object {
          "base": Object {
            "base": Object {
              "base": Object {
                "editMetadata": "initialize",
                "ref": "5",
                "value": Object {},
              },
              "editMetadata": "add world",
              "ref": "6",
              "value": Object {
                "world": "world",
              },
            },
            "editMetadata": "change world",
            "ref": "7",
            "value": Object {
              "world": "vorld",
            },
          },
          "editMetadata": "delete world",
          "ref": "8",
          "value": Object {},
        },
      }
    `);
  });
});
