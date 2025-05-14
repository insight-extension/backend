import * as WebSocket from 'ws';

export interface TranscriptionSession {
  session: WebSocket;
  isUpdated: boolean;
}
