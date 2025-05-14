/*
    Details: https://platform.openai.com/docs/api-reference/realtime-server-events
*/

export enum ServerMessageTypes {
  SESSION_CREATED = 'transcription_session.created',
  SESSION_UPDATED = 'transcription_session.updated',
  ERROR = 'transcription_session.error',
  DELTA = 'response.audio_transcript.delta',
  COMPLETED = 'conversation.item.input_audio_transcription.completed',
}
