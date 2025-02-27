import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from 'src/auth/types/jwt-payload.type';

/* 
    This custom decorator is used to extract 
    the public key from the JWT token.
*/
export const JwtPublicKey = createParamDecorator(
  async (data: unknown, ctx: ExecutionContext) => {
    try {
      const request = ctx.switchToHttp().getRequest();
      const authHeader = request.headers.authorization;
      // TODO: replace with i18n
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedException(
          'Authorization header is missing or invalid',
        );
      }
      const token = authHeader.split(' ')[1];

      const jwtService = new JwtService();
      const payload: JwtPayload = jwtService.decode(token);
      return payload.publicKey;
    } catch (error) {
      throw new UnauthorizedException('JWT decoding failed: ' + error.message);
    }
  },
);
