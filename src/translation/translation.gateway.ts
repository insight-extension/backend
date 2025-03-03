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
import { RealtimeSession } from 'speechmatics';
import { OpenAI } from 'openai';
import { Socket, Server } from 'socket.io';
import { Logger } from '@nestjs/common';
import 'dotenv/config';
import { PaymentService } from 'src/payment/payment.service';
import { WsHeaders } from './constants/ws-headers.enum';
import { TranslationLanguages } from './constants/translation-languages.enum';
import { WsEvents } from './constants/ws-events.enum';
import { WsJwtGuard } from 'src/auth/guards/jwt-ws.guard';
import { I18nService } from 'nestjs-i18n';

@WebSocketGateway({ cors: { origin: '*' } })
export class TranslationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TranslationGateway.name);

  constructor(
    private readonly wsJwtGuard: WsJwtGuard,
    private readonly paymentService: PaymentService,
    private readonly i18n: I18nService,
  ) {}

  @WebSocketServer()
  private server: Server;

  // Active client sessions: clientId -> { session, apiKey }
  private speechmaticSessions: Map<
    string,
    { speechmaticSession: RealtimeSession; speechmaticApiKey: string }
  > = new Map();

  // To track sessions being created
  private creatingSessionsLock: Set<string> = new Set();

  // API key usage status: apiKey -> busy flag (true/false)
  private speechmaticsApiKeyUsage: Map<string, boolean> = new Map();

  // List of API keys
  private readonly SPEECHMATICS_API_KEYS =
    process.env.SPEECHMATICS_API_KEYS?.split(',') || [];
  private readonly OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  // OpenAI client
  private readonly openai = new OpenAI({ apiKey: this.OPENAI_API_KEY });

  afterInit() {
    this.logger.log('Translation gateway initialized');

    // Initialize API keys and their status
    this.SPEECHMATICS_API_KEYS.forEach((key) =>
      this.speechmaticsApiKeyUsage.set(key, false),
    );
  }

  async handleConnection(client: Socket) {
    // Check if user is authorized
    const isAuthorized = await this.wsJwtGuard.canActivate(client);
    // TODO: try to refactor this
    if (isAuthorized) {
      // Start translation with required payment method
      await this.paymentService.startPaymentWithRequiredMethod(client);

      client.on(WsEvents.AUDIO_DATA, async (data: unknown) => {
        if (data instanceof Uint8Array) {
          this.logger.debug('Audio data received');
          await this.handleAudioData(Buffer.from(data), client);
        } else {
          this.logger.error('Invalid audio data received');
        }
      });
    }
  }

  async handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
    await this.cleanupSpeechmaticsSession(client.id);
    await this.paymentService.stopPaymentWithRequiredMethod(client);
  }

  private async cleanupSpeechmaticsSession(clientId: string) {
    if (this.speechmaticSessions.has(clientId)) {
      const { speechmaticSession, speechmaticApiKey } =
        this.speechmaticSessions.get(clientId);

      // Remove the session from the map
      this.speechmaticSessions.delete(clientId);

      // Stop the Speechmatics session
      try {
        await speechmaticSession.stop();
        this.logger.debug(
          `Speechmatics session stopped for client: ${clientId}`,
        );
      } catch (error) {
        this.logger.error(`Error stopping session for client ${clientId}`);
      }

      // Release the API key
      if (speechmaticApiKey) {
        this.speechmaticsApiKeyUsage.set(speechmaticApiKey, false);
      }
    }
  }

  @SubscribeMessage(WsEvents.AUDIO_DATA)
  async handleAudioData(
    @MessageBody() audioData: Buffer,
    @ConnectedSocket() client: Socket,
  ) {
    // If a session is already being created, wait for completion
    if (this.creatingSessionsLock.has(client.id)) {
      return;
    }

    // Check if a session already exists
    if (!this.speechmaticSessions.has(client.id)) {
      this.creatingSessionsLock.add(client.id); // Mark that session creation has started
      try {
        this.logger.debug(`No session found for client ${client.id}`);
        const speechmaticsApiKey = this.getAvailableApiKey();

        if (!speechmaticsApiKey) {
          this.logger.error(`No available API keys for client ${client.id}`);
          client.emit(WsEvents.ERROR, {
            message: this.paymentService.i18nWs(
              client,
              'translation.noAvailableSlots',
            ),
          });
          return;
        }

        let session: RealtimeSession;
        try {
          session = await this.createSpeechmaticsSession(
            speechmaticsApiKey,
            client,
          );
        } catch (error) {
          this.speechmaticsApiKeyUsage.set(speechmaticsApiKey, false);
          throw new Error(error.message);
        }

        // Check if the client disconnected while the session was being created
        if (!client.connected) {
          try {
            await session.stop();
          } catch (error) {
            this.logger.error(`Error stopping session for client ${client.id}`);
          }
          this.speechmaticsApiKeyUsage.set(speechmaticsApiKey, false);
          return;
        }
        this.speechmaticSessions.set(client.id, {
          speechmaticSession: session,
          speechmaticApiKey: speechmaticsApiKey,
        });
      } catch (error) {
        this.logger.error(
          `Error creating session for client ${client.id}, error ${error}`,
        );
        client.emit(WsEvents.ERROR, {
          message: this.paymentService.i18nWs(
            client,
            'translation.failedToStartTranslation',
          ),
        });
        return;
      } finally {
        this.creatingSessionsLock.delete(client.id); // Remove the lock
      }
    }

    // If the session already exists, send audio data
    const { speechmaticSession: session } = this.speechmaticSessions.get(
      client.id,
    );
    try {
      session.sendAudio(audioData);
    } catch (error) {
      this.logger.error(
        `Error sending audio data for client ${client.id}, error ${error}`,
      );
      client.emit(WsEvents.ERROR, {
        message: this.paymentService.i18nWs(
          client,
          'translation.processAudioFailed',
        ),
      });
    }
  }

  private getAvailableApiKey(): string | null {
    for (const [key, inUse] of this.speechmaticsApiKeyUsage.entries()) {
      if (!inUse) {
        // Mark the key as busy
        this.speechmaticsApiKeyUsage.set(key, true);
        return key;
      }
    }
    return null;
  }

  private async createSpeechmaticsSession(
    speechmaticsApiKey: string,
    client: Socket,
  ): Promise<RealtimeSession> {
    this.logger.debug(`Creating Speechmatics session for client ${client.id}`);
    const session = new RealtimeSession(speechmaticsApiKey);

    // Get languages from headers
    const sourceLanguage = this.extractHeaderValue(
      client,
      WsHeaders.SOURCE_LANGUAGE,
    );
    const targetLanguage = this.extractHeaderValue(
      client,
      WsHeaders.TARGET_LANGUAGE,
    );
    this.logger.debug(
      `Source language: ${sourceLanguage}, Target language: ${targetLanguage}`,
    );

    // Validate languages
    if (
      !this.isValidTranslationLanguage(sourceLanguage) ||
      !this.isValidTranslationLanguage(targetLanguage)
    ) {
      throw new Error(
        this.paymentService.i18nWs(client, 'translation.invalidLanguage'),
      );
    }
    if (sourceLanguage === targetLanguage) {
      throw new Error(
        this.paymentService.i18nWs(client, 'translation.sameLanguages'),
      );
    }

    // Buffer for accumulating text received from the client
    let clientBuffer = '';

    session.addListener('AddTranscript', async (message) => {
      const transcript = message.metadata.transcript;
      this.logger.debug(
        `Transcript received for client ${client.id}: ${transcript}`,
      );

      // Update the buffer, ensuring seamless merging of text
      clientBuffer = clientBuffer.trim() + ` ${transcript.trim()}`;

      // Extract complete sentences
      const completedSentences = this.extractCompletedSentences(clientBuffer);
      if (completedSentences.length > 0) {
        clientBuffer = this.getRemainingBuffer(clientBuffer);

        for (const sentence of completedSentences) {
          try {
            // Translate the extracted sentence
            const translatedText = await this.translateText(
              sentence,
              sourceLanguage,
              targetLanguage,
            );
            this.logger.debug(
              `Translation for client ${client.id}: ${translatedText}`,
            );

            // Send both transcription and translation
            client.emit(
              WsEvents.MESSAGE,
              JSON.stringify({ type: 'transcript', transcript: sentence }),
            );
            client.emit(
              WsEvents.MESSAGE,
              JSON.stringify({
                type: 'translation',
                translation: translatedText,
              }),
            );
          } catch (error) {
            this.logger.error(`Error translating: ${sentence}`);
            client.emit(
              WsEvents.MESSAGE,
              JSON.stringify({
                type: 'error',
                message: this.paymentService.i18nWs(
                  client,
                  'translation.translationFailed',
                ),
              }),
            );
          }
        }
      }
    });

    session.addListener('Error', (error) => {
      this.logger.error(
        `Speechmatics error for client ${client.id}, error: ${error}`,
      );
      client.emit(WsEvents.MESSAGE, { type: 'error', message: error.message });
    });

    await session.start({
      transcription_config: {
        language: sourceLanguage,
        enable_partials: true,
      },
      audio_format: {
        type: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: 16000,
      },
    });

    return session;
  }

  // Method for extracting completed sentences
  private extractCompletedSentences(buffer: string): string[] {
    const sentenceRegex = /[^.!?]+[.!?](\s|$)/g;
    const matches = buffer.match(sentenceRegex);
    return matches ? matches.map((s) => s.trim()) : [];
  }

  // Method for retrieving remaining text in the buffer
  private getRemainingBuffer(buffer: string): string {
    const sentenceEndIndex = buffer.lastIndexOf('. ');
    return sentenceEndIndex === -1
      ? ''
      : buffer.slice(sentenceEndIndex + 2).trim();
  }

  private async translateText(
    text: string,
    sourceLang: TranslationLanguages,
    targetLang: TranslationLanguages,
  ): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Just translate text from ${sourceLang} to ${targetLang}, keeping the context. Do not add explanations, comments, or extra text.`,
          },
          {
            role: 'user',
            content: text,
          },
        ],
      });
      return response.choices[0].message.content.trim();
    } catch (error) {
      this.logger.error(`Error communicating with OpenAI API: ${error}`);
      return '';
    }
  }

  // Method for extracting values from headers
  private extractHeaderValue(client: Socket, headerKey: string): string {
    const header = client.handshake.headers[headerKey];
    if (!header) {
      throw new Error(`${headerKey} not specified.`);
    }
    const headerValue = Array.isArray(header) ? header[0] : header;
    return headerValue;
  }

  private isValidTranslationLanguage(
    language: string,
  ): language is TranslationLanguages {
    return Object.values(TranslationLanguages).includes(
      language as TranslationLanguages,
    );
  }
}
