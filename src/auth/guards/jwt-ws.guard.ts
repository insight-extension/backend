import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import 'dotenv/config';
import { Socket } from 'socket.io';
import { AccountService } from 'src/account/account.service';
import { WsEvents } from 'src/translation/constants/ws-events.enum';

@Injectable()
export class WsJwtGuard {
  constructor(
    private jwtService: JwtService,
    private accountService: AccountService,
  ) {}

  async canActivate(client: Socket): Promise<boolean> {
    try {
      // Get handshake headers
      const authHeader = client.request.headers.authorization;
      if (!authHeader) {
        throw new ForbiddenException('Authorization header is missing');
      }

      // Get bearer token from headers
      const bearerToken = authHeader.split(' ')[1];
      if (!bearerToken) {
        throw new ForbiddenException('Token is missing');
      }

      // Get payload from encoded token
      // Throws error if token is invalid
      const payload = await this.jwtService.verifyAsync(bearerToken, {
        secret: process.env.JWT_SECRET,
      });

      return true;
    } catch (error) {
      // Emit error to client and disconnect
      const errorToEmit = new HttpException(
        {
          message: 'Error while authenticating user',
          error: error.message,
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
      client.emit(WsEvents.ERROR, errorToEmit.getResponse());
      client.disconnect();
      Logger.warn(
        `Client's [${client.id}] JWT verification failed: ${error.message}`,
      );
      return false;
    }
  }
}
