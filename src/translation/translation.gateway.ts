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
import { WsJwtGuard } from 'src/auth/guards/jwt-ws.guard';
import { PaymentService } from 'src/payment/payment.service';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Summary } from 'prom-client';
import { TranslationMetrics } from './constants/translation-metrics.enum';
import { TranslationServices } from './constants/translation-services.enum';
import { TranslationMetricLabels } from './constants/translation-metric-labels.enum';

@WebSocketGateway({ cors: { origin: '*' } })
export class TranslationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(TranslationGateway.name);

  constructor(
    private readonly wsJwtGuard: WsJwtGuard,
    private readonly paymentService: PaymentService,
    // Prometheus metrics
    // TODO: add target and source languages to the metrics labels
    @InjectMetric(TranslationMetrics.TRANSLATION_STARTS)
    public translationStarts: Counter<TranslationMetricLabels>,

    @InjectMetric(TranslationMetrics.ACTIVE_TRANSLATIONS)
    public activeTranslations: Gauge<TranslationMetricLabels>,

    @InjectMetric(TranslationMetrics.TRANSLATION_DELAY)
    public translationDelay: Summary<TranslationMetricLabels>,

    @InjectMetric(TranslationMetrics.TRANSLATION_USING)
    public translationUsing: Summary<TranslationMetricLabels>,
  ) {}

  @WebSocketServer()
  private server: Server;

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
  private openai = new OpenAI({ apiKey: this.OPENAI_API_KEY });

  // For tracking translation start date
  // Map<string(clientId), Date>
  private translationStartDate: Map<string, Date> = new Map();

  afterInit() {
    this.logger.log('Translation gateway initialized');

    // Initialize API keys and their status
    this.SPEECHMATICS_API_KEYS.forEach((key) =>
      this.apiKeyUsage.set(key, false),
    );
  }

  async handleConnection(client: Socket) {
    // Increment Prometheus metrics
    this.translationStarts.inc();
    this.activeTranslations.inc();

    // Check if user is authorized
    const isAuthorized = await this.wsJwtGuard.canActivate(client);
    if (isAuthorized) {
      // Start translation with required payment method
      await this.paymentService.startPaymentWithRequiredMethod(client);

      // Store the translation start date
      this.translationStartDate.set(client.id, new Date());

      client.on('audioData', async (data: any) => {
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
    this.activeTranslations.dec();

    // Calculate the duration of translation usage
    const startDate = this.translationStartDate.get(client.id);
    if (startDate) {
      const durationInSeconds = (Date.now() - startDate.getTime()) / 1000; // ms to s
      const subscriptionType = this.paymentService.getSubscriptionType(client);

      this.translationUsing.observe(
        { subscription_type: subscriptionType },
        durationInSeconds,
      );
      this.translationStartDate.delete(client.id);
    }

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

  @SubscribeMessage('audioData')
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
          client.emit('error', {
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
          throw new Error(error);
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
        client.emit('error', {
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
      client.emit('error', { message: 'Failed to process audio data.' });
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

    // Start the timer for transcription metric
    const startTranscriptionMetric = Date.now();
    let isTranscriptionMetricCalculated = false;

    const session = new RealtimeSession(apiKey);

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
        // Calculate transcription metric for the first got sentence
        if (!isTranscriptionMetricCalculated) {
          const transcriptionDuration =
            (Date.now() - startTranscriptionMetric) / 1000; // ms to s
          this.translationDelay.observe(
            { service: TranslationServices.SPEECHMATICS },
            transcriptionDuration,
          );
          isTranscriptionMetricCalculated = true;
        }

        clientBuffer = this.getRemainingBuffer(clientBuffer);

        for (const sentence of completedSentences) {
          try {
            // Translate the extracted sentence
            const translatedText = await this.translateText(
              sentence,
              'en',
              'ua',
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
        language: 'en',
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
    sourceLang: string = 'en',
    targetLang: string = 'ua',
  ): Promise<string> {
    // Start the timer for translation delay
    const translationStart = Date.now();
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Just translate text from ${sourceLang} to ${targetLang}, keeping the context.`,
          },
          {
            role: 'user',
            content: text,
          },
        ],
      });
      const translationDuration = (Date.now() - translationStart) / 1000;
      this.translationDelay.observe(
        { service: TranslationServices.CHAT_GPT },
        translationDuration,
      );
      return response.choices[0].message.content.trim();
    } catch (error) {
      this.logger.error(`Error communicating with OpenAI API: ${error}`);
      return '';
    }
  }
}
