import type { NotionBlock, NotionBlockType } from './types';

export function parseMarkdownToBlocks(markdown: string): NotionBlock[] {
  if (!markdown || !markdown.trim()) {
    return [{ id: 'b-0', type: 'paragraph', text: '' }];
  }

  const lines = markdown.split('\n');
  const blocks: NotionBlock[] = [];
  let blockCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      if (blocks.length > 0 && blocks[blocks.length - 1].text === '') {
        continue;
      }
      blocks.push({
        id: `b-${blockCounter++}`,
        type: 'paragraph',
        text: '',
      });
      continue;
    }

    if (line.startsWith('# ')) {
      blocks.push({
        id: `b-${blockCounter++}`,
        type: 'h1',
        text: line.substring(2).trim(),
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        id: `b-${blockCounter++}`,
        type: 'h2',
        text: line.substring(3).trim(),
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        id: `b-${blockCounter++}`,
        type: 'h3',
        text: line.substring(4).trim(),
      });
    } else if (line.startsWith('> ')) {
      blocks.push({
        id: `b-${blockCounter++}`,
        type: 'quote',
        text: line.substring(2).trim(),
      });
    } else {
      const taskMatch = line.match(
        /^(?:\[task(?::(done|x))?:\s*(.+?)\]|[-*]\s+\[([ xX])\]\s+\[task\]\s+(.+))$/i,
      );
      if (taskMatch) {
        const isDone = Boolean(
          taskMatch[1] || (taskMatch[3] && taskMatch[3].toLowerCase() === 'x'),
        );
        const text = (taskMatch[2] || taskMatch[4] || '').trim();
        blocks.push({
          id: `b-${blockCounter++}`,
          type: 'task',
          text,
          checked: isDone,
        });
      } else {
        const todoMatch = line.match(/^(\s*[-*]\s*\[)([ xX])(\])\s*(.*)$/);
        if (todoMatch) {
          blocks.push({
            id: `b-${blockCounter++}`,
            type: 'todo',
            text: todoMatch[4] || '',
            checked: todoMatch[2].toLowerCase() === 'x',
          });
        } else {
          const bulletMatch = line.match(/^(\s*[-*])\s+(.*)$/);
          if (bulletMatch) {
            blocks.push({
              id: `b-${blockCounter++}`,
              type: 'bullet',
              text: bulletMatch[2] || '',
            });
          } else {
            blocks.push({
              id: `b-${blockCounter++}`,
              type: 'paragraph',
              text: line,
            });
          }
        }
      }
    }
  }

  if (blocks.length === 0) {
    blocks.push({ id: 'b-0', type: 'paragraph', text: '' });
  }

  return blocks;
}

export function serializeBlocksToMarkdown(blocks: NotionBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'h1':
          return `# ${b.text}`;
        case 'h2':
          return `## ${b.text}`;
        case 'h3':
          return `### ${b.text}`;
        case 'task':
          return `[task:${b.checked ? 'done:' : ''} ${b.text}]`;
        case 'todo':
          return `- [${b.checked ? 'x' : ' '}] ${b.text}`;
        case 'bullet':
          return `- ${b.text}`;
        case 'quote':
          return `> ${b.text}`;
        default:
          return b.text;
      }
    })
    .join('\n');
}

export function detectMarkdownShortcut(
  val: string,
): { type: NotionBlockType; text: string; checked?: boolean } | null {
  if (val.startsWith('# ')) {
    return { type: 'h1', text: val.substring(2) };
  }
  if (val.startsWith('## ')) {
    return { type: 'h2', text: val.substring(3) };
  }
  if (val.startsWith('### ')) {
    return { type: 'h3', text: val.substring(4) };
  }
  if (val.startsWith('> ')) {
    return { type: 'quote', text: val.substring(2) };
  }
  if (
    val.startsWith('- [ ] ') ||
    val.startsWith('[] ') ||
    val.startsWith('[ ] ')
  ) {
    return {
      type: 'todo',
      checked: false,
      text: val.replace(/^(\s*[-*]\s*\[\s*\]\s*|\[\s*\]\s*)/, ''),
    };
  }
  if (val.startsWith('- [x] ') || val.startsWith('[x] ')) {
    return {
      type: 'todo',
      checked: true,
      text: val.replace(/^(\s*[-*]\s*\[[xX]\]\s*|\[[xX]\]\s*)/, ''),
    };
  }
  if (val.startsWith('- ') || val.startsWith('* ') || val.startsWith('+ ')) {
    return { type: 'bullet', text: val.substring(2) };
  }
  return null;
}

export function toggleMarkdownTask(text: string, taskIndex: number): string {
  let currentTask = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const taskMatch = line.match(/^(\s*\[task)(?::(done|x))?(:\s*.*\]\s*)$/i);
    if (taskMatch) {
      if (currentTask++ === taskIndex) {
        const isDone = Boolean(taskMatch[2]);
        lines[i] = isDone
          ? `${taskMatch[1]}${taskMatch[3]}`
          : `${taskMatch[1]}:done${taskMatch[3]}`;
        return lines.join('\n');
      }
      continue;
    }
    const todoMatch = line.match(/^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/);
    if (todoMatch) {
      if (currentTask++ === taskIndex) {
        const nextState = todoMatch[2].toLowerCase() === 'x' ? ' ' : 'x';
        lines[i] = `${todoMatch[1]}${nextState}${todoMatch[3]}`;
        return lines.join('\n');
      }
    }
  }
  return text;
}
