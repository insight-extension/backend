import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OpenAI } from 'openai';
import { Socket, Server } from 'socket.io';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { PaymentService } from 'src/payment/payment.service';
import { ExtensionExtraHeaders } from './constants/extra-headers.enum';
import { TranslationLanguages } from './constants/translation-languages.enum';
import { ExtensionEvents as ExtensionEvents } from './constants/extension-events.enum';
import { WsJwtGuard } from 'src/auth/guards/jwt-ws.guard';
import * as WebSocket from 'ws';
import { ExtractTranslationLanguages } from './types/extract-translation-languages.type';
import { ServerMessageTypes } from './constants/server-message-types.enum';
import { ClientMessageTypes } from './constants/client-message-types.enum';
import { TranscriptionSession } from './interfaces/transcription-session.interface';

@WebSocketGateway({ cors: { origin: '*' } })
export class TranslationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TranslationGateway.name);

  constructor(
    private readonly wsJwtGuard: WsJwtGuard,
    private readonly paymentService: PaymentService,
  ) {}

  @WebSocketServer()
  private readonly server: Server;

  // OpenAI transcription sessions
  // ClientId -> TranscriptionSession
  private readonly transcriptionSessions: Map<string, TranscriptionSession> =
    new Map();

  // List of API keys
  private readonly OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  // OpenAI client
  private readonly openai = new OpenAI({ apiKey: this.OPENAI_API_KEY });

  // OpenAI transcription URL
  // Source: https://platform.openai.com/docs/guides/realtime?use-case=transcription#connect-with-websockets
  private readonly OPENAI_TRANSCRIPTION_URL =
    'wss://api.openai.com/v1/realtime?intent=transcription';

  afterInit() {
    this.logger.log('Translation gateway initialized');
  }

  async handleConnection(client: Socket) {
    const isAuthorized = await this.wsJwtGuard.canActivate(client);
    if (isAuthorized) {
      await this.paymentService.startPaymentWithRequiredMethod(client);
      this.subscribeOnAudioData;
    }
  }

  private subscribeOnAudioData(client: Socket) {
    client.on(ExtensionEvents.AUDIO_DATA, async (data: unknown) => {
      if (data instanceof Uint8Array) {
        await this.handleAudioData(Buffer.from(data), client);
      } else {
        this.logger.error('Invalid audio data received');
      }
    });
  }

  async handleDisconnect(client: Socket) {
    await this.cleanupSession(client.id);
    await this.paymentService.stopPaymentWithRequiredMethod(client);
    this.logger.debug(
      `Client ${client.id} disconnected. Sessions: ${this.transcriptionSessions.size}`,
    );
  }

  private async cleanupSession(clientId: string) {
    const transcriptionSession = this.transcriptionSessions.get(clientId);

    if (transcriptionSession) {
      transcriptionSession.session.close();
      this.transcriptionSessions.delete(clientId);
      this.logger.debug(`Transcription session closed for client ${clientId}`);
    }
  }

  @SubscribeMessage(ExtensionEvents.AUDIO_DATA)
  async handleAudioData(
    @MessageBody() audioData: Buffer,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      if (!this.transcriptionSessions.has(client.id)) {
        const session = this.createTranscriptionSession(client);

        this.transcriptionSessions.set(client.id, {
          session,
          isUpdated: false,
        });

        this.logger.debug(
          `Creating new transcription session for client ${client.id}`,
        );
      }
    } catch (error) {
      client.emit(ExtensionEvents.ERROR, {
        message: 'Failed to create transcription session.',
      });
    }

    const transcriptionSession = this.transcriptionSessions.get(client.id);
    try {
      if (!transcriptionSession.isUpdated) {
        this.logger.debug(
          `Transcription session for client ${client.id} is not updated yet.`,
        );
        return;
      }

      this.sendAudioToOpenAI(transcriptionSession.session, audioData);
    } catch (error) {
      this.logger.error(
        `Error sending audio data for client ${client.id}, error ${error}`,
      );
      // TODO: Add i18n. Remove unnecessary constants from i18n file
      client.emit(ExtensionEvents.ERROR, {
        message: 'Failed to process audio data.',
      });
    }
  }

  private async createSessionIfNotExists(client: Socket) {
    try {
      if (!this.transcriptionSessions.has(client.id)) {
        const session = this.createTranscriptionSession(client);

        this.transcriptionSessions.set(client.id, {
          session,
          isUpdated: false,
        });

        this.logger.debug(
          `Creating new transcription session for client ${client.id}`,
        );
      }
    } catch (error) {
      client.emit(ExtensionEvents.ERROR, {
        message: 'Failed to create transcription session.',
      });
    }
  }

  private createTranscriptionSession(client: Socket): WebSocket {
    const ws = new WebSocket(
      this.OPENAI_TRANSCRIPTION_URL,
      this.getOpenAIHeaders(),
    );

    this.subscribeOnOpen(ws, client);
    this.subscribeOnClose(ws, client);
    this.subscribeOnMessage(ws, client);

    return ws;
  }

  private getOpenAIHeaders() {
    return {
      headers: {
        Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
        'OpenAI-Beta': 'realtime=v1',
      },
    };
  }

  private setSessionConfig(
    ws: WebSocket,
    sourceLanguage: TranslationLanguages,
  ) {
    ws.send(
      JSON.stringify({
        type: ClientMessageTypes.SESSION_UPDATE,
        session: this.getSessionConfig(sourceLanguage),
      }),
    );
  }

  private getSessionConfig(sourceLanguage: TranslationLanguages) {
    return {
      input_audio_noise_reduction: null,
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 200,
      },
      input_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'gpt-4o-mini-transcribe',
        language: sourceLanguage,
        prompt: '',
      },
      include: null,
    };
  }

  private subscribeOnOpen(ws: WebSocket, client: Socket) {
    const { sourceLanguage } = this.extractTranslationLanguages(client);
    ws.on('open', () => {
      this.logger.debug('Connected to server.');
      this.setSessionConfig(ws, sourceLanguage);
    });
  }

  private subscribeOnClose(ws: WebSocket, client: Socket) {
    ws.on('close', () => {
      this.logger.debug(`WebSocket connection closed for client ${client.id}`);

      if (this.transcriptionSessions.has(client.id)) {
        this.transcriptionSessions.delete(client.id);
      }
    });
  }

  private subscribeOnMessage(ws: WebSocket, client: Socket) {
    ws.on('message', async (message: any) => {
      const data = JSON.parse(message.toString());
      this.logger.debug(data);

      let transcriptionBuffer = '';
      let translationBuffer = '';

      switch (data.type) {
        case ServerMessageTypes.SESSION_CREATED:
          this.logger.debug('Session created:', data);

        case ServerMessageTypes.SESSION_UPDATED:
          this.transcriptionSessions.set(client.id, {
            session: ws,
            isUpdated: true,
          });
          this.logger.debug('Session updated:', data);

        case ServerMessageTypes.ERROR:
          this.logger.error('Session error:', data);
          throw new Error('Session error: ' + data.error.message);

        // Handle the transcription sentences parts from OpenAI
        case ServerMessageTypes.DELTA:
          this.logger.debug('Audio transcript delta:', data);
          break;

        // Handle the completed transcription sentences from OpenAI
        case ServerMessageTypes.COMPLETED:
          const transcriptionSentence: string = data.transcript;
          this.logger.debug('Transcription: ', transcriptionSentence);

          transcriptionBuffer += transcriptionSentence + ' ';
          this.emitTranscription(client, transcriptionBuffer);

          // Check transcription sentence to not be empty to not cause OpenAI API error
          if (transcriptionSentence === '' || !transcriptionSentence?.trim()) {
            return;
          }

          const translation = await this.translateText(
            transcriptionSentence,
            client,
          );
          translationBuffer += translation + ' ';
          this.emitTranslation(client, translationBuffer);
          break;
      }
    });
  }

  private emitTranscription(client: Socket, transcriptionBuffer: string): void {
    client.emit(
      ExtensionEvents.MESSAGE,
      JSON.stringify({
        type: 'transcript',
        transcript: transcriptionBuffer,
      }),
    );
  }

  private emitTranslation(client: Socket, translationBuffer: string): void {
    client.emit(
      ExtensionEvents.MESSAGE,
      JSON.stringify({
        type: 'translation',
        translation: translationBuffer,
      }),
    );
  }

  private async translateText(text: string, client: Socket): Promise<string> {
    const { sourceLanguage, targetLanguage } =
      this.extractTranslationLanguages(client);

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Just translate text from ${sourceLanguage} to ${targetLanguage}, keeping the context. Do not add explanations, comments, or extra text.`,
          },
          {
            role: 'user',
            content: text,
          },
        ],
      });

      const translate = response.choices[0].message.content.trim();
      this.logger.debug(`Translation: ${translate}`);
      return translate;
    } catch (error) {
      this.logger.error(`Error translating with OpenAI API: ${error}`);
      return '';
    }
  }

  private extractTranslationLanguages(
    client: Socket,
  ): ExtractTranslationLanguages {
    const sourceLanguage = this.extractHeaderValue(
      client,
      ExtensionExtraHeaders.SOURCE_LANGUAGE,
    );
    const targetLanguage = this.extractHeaderValue(
      client,
      ExtensionExtraHeaders.TARGET_LANGUAGE,
    );
    this.logger.debug(
      `Source language: ${sourceLanguage}, Target language: ${targetLanguage}`,
    );

    this.validateLanguages(sourceLanguage, targetLanguage);

    return {
      sourceLanguage: sourceLanguage as TranslationLanguages,
      targetLanguage: targetLanguage as TranslationLanguages,
    };
  }

  private extractHeaderValue(client: Socket, headerKey: string): string {
    const header = client.handshake.headers[headerKey];
    if (!header) {
      throw new Error(`${headerKey} not specified.`);
    }
    const headerValue = Array.isArray(header) ? header[0] : header;
    return headerValue;
  }

  private validateLanguages(
    sourceLanguage: string,
    targetLanguage: string,
  ): void {
    if (!this.isValidTranslationLanguage(sourceLanguage)) {
      throw new Error('Invalid source language.');
    }
    if (!this.isValidTranslationLanguage(targetLanguage)) {
      throw new Error('Invalid target language.');
    }
    if (sourceLanguage === targetLanguage) {
      throw new Error('Source and target languages are the same.');
    }
  }
  private isValidTranslationLanguage(
    language: string,
  ): language is TranslationLanguages {
    return Object.values(TranslationLanguages).includes(
      language as TranslationLanguages,
    );
  }

  private sendAudioToOpenAI(ws: WebSocket, audioData: Buffer): void {
    ws.send(
      JSON.stringify({
        type: ClientMessageTypes.APPEND_AUDIO,
        audio: audioData.toString('base64'),
      }),
    );
  }
}
