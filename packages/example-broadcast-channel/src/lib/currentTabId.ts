import generate from 'project-name-generator';

// Based on https://stackoverflow.com/a/61415444
const STORAGE_KEY = 'tabIdStorageKey';
function initTabId() {
  const sessionId = sessionStorage.getItem(STORAGE_KEY);
  if (sessionId) {
    sessionStorage.removeItem(STORAGE_KEY);
    return sessionId;
  }
  return generate({ words: 3, alliterative: true }).dashed;
}

export const currentTabId = initTabId();

window.addEventListener('beforeunload', () => {
  sessionStorage.setItem(STORAGE_KEY, currentTabId);
});
