/*
    Details: https://platform.openai.com/docs/api-reference/realtime-client-events
*/

export enum ClientMessageTypes {
  APPEND_AUDIO = 'input_audio_buffer.append',
  TRANSCRIPTION_SESSION_UPDATE = 'transcription_session.update',
  S2S_SESSION_UPDATE = 'session.update',
}
