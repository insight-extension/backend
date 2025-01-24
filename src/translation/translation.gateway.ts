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

@WebSocketGateway({ cors: { origin: '*' } })
export class TranslationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  constructor(
    private readonly wsJwtGuard: WsJwtGuard,
    private readonly paymentService: PaymentService,
  ) {}

  @WebSocketServer()
  private server: Server;

  // Active client sessions: clientId -> { session, apiKey }
  private speechmaticsSessions: Map<
    string,
    { session: RealtimeSession; apiKey: string }
  > = new Map();

  // API key usage status: apiKey -> busy flag (true/false)
  private apiKeyUsage: Map<string, boolean> = new Map();

  // List of API keys
  private readonly SPEECHMATICS_API_KEYS =
    process.env.SPEECHMATICS_API_KEYS?.split(',') || [];
  private readonly OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  // OpenAI client
  private openai = new OpenAI({ apiKey: this.OPENAI_API_KEY });

  afterInit() {
    Logger.log('Translation gateway initialized');

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
      this.paymentService.startPaymentWithRequiredMethod(client);

      client.on('audioData', async (data: any) => {
        if (data instanceof Uint8Array) {
          await this.handleAudioData(Buffer.from(data), client);
        } else {
          console.warn('Unexpected data format:', typeof data);
        }
      });
    }
  }

  async handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    await this.cleanupSession(client.id);
    await this.paymentService.stopPaymentWithRequiredMethod(client);
  }

  private async cleanupSession(clientId: string) {
    if (this.speechmaticsSessions.has(clientId)) {
      const { session, apiKey } = this.speechmaticsSessions.get(clientId);

      // Stop the Speechmatics session
      await session.stop();
      console.log(`Stopped Speechmatics session for client: ${clientId}`);

      // Remove the session from the map
      this.speechmaticsSessions.delete(clientId);

      // Release the API key
      if (apiKey) {
        this.apiKeyUsage.set(apiKey, false);
        console.log(`Released API key ${apiKey}`);
      }
    }
  }

  // To track sessions being created
  private creatingSessions: Set<string> = new Set();

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
        console.log(
          `No session found for client ${client.id}, creating one...`,
        );
        const apiKey = this.getAvailableApiKey();
        if (!apiKey) {
          console.error('No available API keys');
          client.emit('error', {
            message: 'No available API keys. Try again later.',
          });
          return;
        }

        const session = await this.createSpeechmaticsSession(apiKey, client.id);
        this.speechmaticsSessions.set(client.id, { session, apiKey });
      } catch (error) {
        console.error(`Error creating session for client ${client.id}:`, error);
        client.emit('error', {
          message: 'Failed to start Speechmatics session.',
        });
      } finally {
        this.creatingSessions.delete(client.id); // Remove the lock
      }
    }

    // If the session already exists, send audio data
    const { session } = this.speechmaticsSessions.get(client.id);
    try {
      session.sendAudio(audioData);
    } catch (error) {
      console.error(`Error sending audio for client ${client.id}:`, error);
      client.emit('error', { message: 'Failed to process audio data.' });
    }
  }

  private getAvailableApiKey(): string | null {
    for (const [key, inUse] of this.apiKeyUsage.entries()) {
      if (!inUse) {
        // Mark the key as busy
        this.apiKeyUsage.set(key, true);
        console.log(`Assigned API key: ${key}`);
        return key;
      }
    }
    console.log('No available API keys');
    return null;
  }

  private async createSpeechmaticsSession(
    apiKey: string,
    clientId: string,
  ): Promise<RealtimeSession> {
    console.log(
      `Creating Speechmatics session for client ${clientId} using key ${apiKey}`,
    );
    const session = new RealtimeSession(apiKey);

    // Buffer for accumulating text received from the client
    let clientBuffer = '';

    session.addListener('AddTranscript', async (message) => {
      const transcript = message.metadata.transcript;
      console.log(`Transcript received for client ${clientId}: ${transcript}`);

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
              'en',
              'ua',
            );
            console.log(
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
            console.error(`Translation error for client ${clientId}:`, error);
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
      console.error(`Speechmatics error for client ${clientId}:`, error);
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

      return response.choices[0].message.content.trim();
    } catch (error) {
      console.error('Error communicating with OpenAI API:', error);
      return '';
    }
  }
}
