export function getFullId(userId: string, clientId: string) {
  return `${userId}:${clientId}`;
}

export function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
