/*
    Details: https://platform.openai.com/docs/api-reference/realtime-client-events
*/

export enum ClientMessageTypes {
  APPEND_AUDIO = 'input_audio_buffer.append',
  SESSION_UPDATE = 'transcription_session.update',
}
