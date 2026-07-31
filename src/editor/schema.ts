import { Schema } from 'prosemirror-model';

export const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'text*',
      toDOM() { return ['p', 0]; },
      parseDOM: [{ tag: 'p' }],
    },
    text: { inline: true },
  },
});
