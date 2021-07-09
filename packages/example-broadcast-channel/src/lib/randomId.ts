import generate from 'project-name-generator';

export function randomId() {
  return generate({ words: 3, alliterative: true }).dashed;
}
