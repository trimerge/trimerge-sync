export function getFullId(userId: string, cursorId: string) {
  return `${userId}:${cursorId}`;
}

export function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
