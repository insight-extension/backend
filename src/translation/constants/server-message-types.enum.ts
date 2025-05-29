/*
    Source: https://platform.openai.com/docs/api-reference/realtime-server-events
*/

export enum ServerMessageTypes {
  // Basic
  ERROR = 'error',

  // Transcription
  TRANSCRIPTION_SESSION_CREATED = 'transcription_session.created',
  TRANSCRIPTION_SESSION_UPDATED = 'transcription_session.updated',
  TRANSCRIPTION_SESSION_ERROR = 'transcription_session.error',

  // S2S
  S2S_SESSION_CREATED = 'session.created',
  S2S_SESSION_UPDATED = 'session.updated',

  // Conversation
  TRANSCRIPTION_COMPLETED = 'conversation.item.input_audio_transcription.completed',

  // Response
  TRANSCRIPT_DELTA = 'response.audio_transcript.delta',

  RESPONSE_DONE = 'response.done',
  OUTPUT_ITEM_DONE = 'response.output_item.done',
  CONTENT_PART_DONE = 'response.content_part.done',
  TEXT_DONE = 'response.text.done',
  AUDIO_TRANSCRIPT_DONE = 'response.audio_transcript.done',
  AUDIO_DELTA = 'response.audio.delta',
}
