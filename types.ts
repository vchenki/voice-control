
export enum AppStatus {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  OPTIMIZING = 'OPTIMIZING',
  FINISHED = 'FINISHED',
  ERROR = 'ERROR'
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  rawInput: string;
  optimizedPrompt: string;
}

export interface GeminiPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

// Fixed declaration: used AIStudio interface as requested by compiler error
// and placed inside declare global to ensure it matches the existing global definition.
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio: AIStudio;
  }
}
