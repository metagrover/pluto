export type NotionBlockType =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'todo'
  | 'task'
  | 'bullet'
  | 'quote'
  | 'paragraph';

export interface NotionBlock {
  id: string;
  type: NotionBlockType;
  text: string;
  checked?: boolean;
  authorship?: 'human' | 'ai';
  speaker?: string;
  edited?: boolean;
  evidence?: string;
  transcriptRange?: [number, number];
  path?: string;
  originalText?: string;
}

export type SlashMenuMode = 'root' | 'person' | 'project' | 'task';

export interface SlashMenuState {
  isOpen: boolean;
  blockIndex: number;
  query: string;
  selectedIndex: number;
  mode: SlashMenuMode;
}

export const INITIAL_SLASH_MENU: SlashMenuState = {
  isOpen: false,
  blockIndex: -1,
  query: '',
  selectedIndex: 0,
  mode: 'root',
};

export interface SlashCommand {
  id: string;
  title: string;
  shortcut: string;
  keywords: string[];
  description: string;
  icon: any;
}

export interface EntityOption {
  id: string;
  name: string;
  type: 'person' | 'project';
}

export interface AvailableTask {
  id: string;
  title: string;
  status: 'active' | 'completed';
}
