
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
