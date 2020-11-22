export type BaseUserState = {
  lastUpdate: number;
  name?: string;
  focusId?: string;
  selectedItem?: string;
  selectionStart?: number;
  selectionEnd?: number;
};

export type StateWithUsers = {
  users: Record<string, BaseUserState>;
};
