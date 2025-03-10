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
import { ExtraHeaders } from './constants/extra-headers.enum';
import { TranslationLanguages } from './constants/translation-languages.enum';
import { WsEvents } from './constants/ws-events.enum';
import { WsJwtGuard } from 'src/auth/guards/jwt-ws.guard';

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

  // Active client sessions: clientId -> { session, apiKey }
  private speechmaticsSessions: Map<
    string,
    { session: RealtimeSession; apiKey: string }
  > = new Map();

  // To track sessions being created
  private creatingSessions: Set<string> = new Set();

  // API key usage status: apiKey -> busy flag (true/false)
  private apiKeyUsage: Map<string, boolean> = new Map();

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
      this.apiKeyUsage.set(key, false),
    );
  }

  async handleConnection(client: Socket) {
    // Check if user is authorized
    const isAuthorized = await this.wsJwtGuard.canActivate(client);
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
    await this.cleanupSession(client.id);
    await this.paymentService.stopPaymentWithRequiredMethod(client);
  }

  private async cleanupSession(clientId: string) {
    if (this.speechmaticsSessions.has(clientId)) {
      const { session, apiKey } = this.speechmaticsSessions.get(clientId);

      // Remove the session from the map
      this.speechmaticsSessions.delete(clientId);

      // Stop the Speechmatics session
      try {
        await session.stop();
        this.logger.debug(
          `Speechmatics session stopped for client: ${clientId}`,
        );
      } catch (error) {
        this.logger.error(`Error stopping session for client ${clientId}`);
      }

      // Release the API key
      if (apiKey) {
        this.apiKeyUsage.set(apiKey, false);
      }
    }
  }

  @SubscribeMessage(WsEvents.AUDIO_DATA)
  async handleAudioData(
    @MessageBody() audioData: Buffer,
    @ConnectedSocket() client: Socket,
  ) {
    // If a session is already being created, wait for completion
    if (this.creatingSessions.has(client.id)) {
      return;
    }

    // Check if a session already exists
    if (!this.speechmaticsSessions.has(client.id)) {
      this.creatingSessions.add(client.id); // Mark that session creation has started
      try {
        this.logger.debug(`No session found for client ${client.id}`);
        const apiKey = this.getAvailableApiKey();

        if (!apiKey) {
          this.logger.error(`No available API keys for client ${client.id}`);
          client.emit(WsEvents.ERROR, {
            message: 'No available slots for translations. Try again later.',
          });
          return;
        }

        // this.apiKeyUsage.set(apiKey, false);
        let session: RealtimeSession;
        try {
          session = await this.createSpeechmaticsSession(apiKey, client.id);
        } catch (error) {
          this.apiKeyUsage.set(apiKey, false);
          throw new Error(error.message);
        }

        // Check if the client disconnected while the session was being created
        if (!client.connected) {
          try {
            await session.stop();
          } catch (error) {
            this.logger.error(`Error stopping session for client ${client.id}`);
          }
          this.apiKeyUsage.set(apiKey, false);
          return;
        }
        this.speechmaticsSessions.set(client.id, { session, apiKey });
      } catch (error) {
        this.logger.error(
          `Error creating session for client ${client.id}, error ${error}`,
        );
        client.emit(WsEvents.ERROR, {
          message: 'Failed to start translation session.',
        });
        return;
      } finally {
        this.creatingSessions.delete(client.id); // Remove the lock
      }
    }

    // If the session already exists, send audio data
    const { session } = this.speechmaticsSessions.get(client.id);
    try {
      session.sendAudio(audioData);
    } catch (error) {
      this.logger.error(
        `Error sending audio data for client ${client.id}, error ${error}`,
      );
      // TODO: Add i18n. Remove unnecessary constants from i18n file
      client.emit(WsEvents.ERROR, { message: 'Failed to process audio data.' });
    }
  }

  private getAvailableApiKey(): string | null {
    for (const [key, inUse] of this.apiKeyUsage.entries()) {
      if (!inUse) {
        // Mark the key as busy
        this.apiKeyUsage.set(key, true);
        return key;
      }
    }
    return null;
  }

  private async createSpeechmaticsSession(
    apiKey: string,
    clientId: string,
  ): Promise<RealtimeSession> {
    this.logger.debug(`Creating Speechmatics session for client ${clientId}`);
    // TODO: Check for user instance usage instead of server
    const session = new RealtimeSession(apiKey);

    // Get the client socket's instance
    const client = this.server.sockets.sockets.get(clientId);

    // Get languages from headers
    const sourceLanguage = this.extractHeaderValue(
      client,
      ExtraHeaders.SOURCE_LANGUAGE,
    );
    const targetLanguage = this.extractHeaderValue(
      client,
      ExtraHeaders.TARGET_LANGUAGE,
    );
    this.logger.debug(
      `Source language: ${sourceLanguage}, Target language: ${targetLanguage}`,
    );

    // Validate languages
    if (
      !this.isValidTranslationLanguage(sourceLanguage) ||
      !this.isValidTranslationLanguage(targetLanguage)
    ) {
      throw new Error('Invalid source or target language.');
    }
    if (sourceLanguage === targetLanguage) {
      throw new Error('Source and target languages are the same.');
    }

    // Buffer for accumulating text received from the client
    let clientBuffer = '';

    session.addListener('AddTranscript', async (message) => {
      const transcript = message.metadata.transcript;
      this.logger.debug(
        `Transcript received for client ${clientId}: ${transcript}`,
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
              `Translation for client ${clientId}: ${translatedText}`,
            );

            // Send both transcription and translation
            this.server
              .to(clientId)
              .emit(
                'message',
                JSON.stringify({ type: 'transcript', transcript: sentence }),
              );
            this.server.to(clientId).emit(
              'message',
              JSON.stringify({
                type: 'translation',
                translation: translatedText,
              }),
            );
          } catch (error) {
            this.logger.error(`Error translating: ${sentence}`);
            this.server.to(clientId).emit(
              'message',
              JSON.stringify({
                type: 'error',
                message: 'Translation failed.',
              }),
            );
          }
        }
      }
    });

    session.addListener('Error', (error) => {
      this.logger.error(
        `Speechmatics error for client ${clientId}, error: ${error}`,
      );
      this.server
        .to(clientId)
        .emit('message', { type: 'error', message: error.message });
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
    sourceLang: string,
    targetLang: string,
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
