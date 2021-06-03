import { diff_match_patch } from 'diff-match-patch';

export const dmp = new diff_match_patch();

export function flattenUnidiffs(diff1: string, diff2: string): string {
  const patches1 = dmp.patch_fromText(diff1);
  const patches2 = dmp.patch_fromText(diff2);
  return dmp.patch_toText([...patches1, ...patches2]);
}

export function computeUnidiff(a: string, b: string): string {
  return dmp.patch_toText(dmp.patch_make(a, b));
}
export function patchUnidiff(text: string, diff: string): string {
  const [patched, success] = dmp.patch_apply(dmp.patch_fromText(diff), text);
  for (const result of success) {
    if (!result) {
      throw new Error('text patch failed');
    }
  }
  return patched;
}
