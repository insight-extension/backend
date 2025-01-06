import { ExecutionContext, Injectable } from '@nestjs/common';
import { I18nResolver } from 'nestjs-i18n';
import { Socket } from 'socket.io';

@Injectable()
export class WebSocketLanguageResolver implements I18nResolver {
  resolve(context: ExecutionContext): string[] | string | undefined {
    // Check if the context is a websocket context
    if (context.getType() !== 'ws') {
      return undefined;
    }

    // Get the client from the context
    const client: Socket = context.switchToWs().getClient();

    // Return the language from the client's headers or 'en' as default
    return client.handshake.headers['Accept-Language'] || 'en';
  }
}
