import { randomId } from './randomId';

// Based on https://stackoverflow.com/a/61415444
const STORAGE_KEY = 'tabIdStorageKey';

function initTabId() {
  try {
    const sessionId = sessionStorage.getItem(STORAGE_KEY);
    if (sessionId) {
      sessionStorage.removeItem(STORAGE_KEY);
      return sessionId;
    }
  } catch (e) {
    console.error("Couldn't get sessionStorage", e);
  }
  return randomId();
}

export const currentTabId = initTabId();

// TODO(matt): figure out how to do this in an isomorphic way
// if (window) {
//   window.addEventListener('beforeunload', () => {
//     sessionStorage.setItem(STORAGE_KEY, currentTabId);
//   });
// }
