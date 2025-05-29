import * as WebSocket from 'ws';

export interface TranscriptionSession {
  openaiSession: WebSocket;
  isUpdated: boolean;
}
