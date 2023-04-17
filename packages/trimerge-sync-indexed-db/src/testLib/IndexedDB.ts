import { getIdbpDatabase } from '../IndexedDbCommitRepository';

export function getIdbDatabases(): Promise<
  { name: string; version: number }[]
> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  return indexedDB.databases();
}

export async function dumpDatabase(docId: string): Promise<any> {
  const idb = await getIdbpDatabase(docId);
  const dump: any = {};
  for (const name of idb.objectStoreNames) {
    dump[name] = await idb.getAll(name);
  }
  await idb.close();
  return dump;
}
