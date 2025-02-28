import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from 'src/auth/types/jwt-payload.type';
import { I18nService } from 'nestjs-i18n';
import { AppModule } from 'src/app.module';
import { i18n } from '../types/i18n.type';

/*
 *  This custom decorator is used to extract
 *  the public key from the JWT token.
 */
export const JwtPublicKey = createParamDecorator(
  async (data: unknown, ctx: ExecutionContext) => {
    // const i18n = AppModule.moduleRef.get(I18nService<i18n>, {
    //   strict: false,
    // });
    try {
      const request = ctx.switchToHttp().getRequest();
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedException();
        //i18n.t('utils.decorators.jwtPublicKey.noAuthHeader'),
      }
      const token = authHeader.split(' ')[1];

      const jwtService = new JwtService();
      const payload: any = jwtService.decode(token);
      return payload.publicKey;
    } catch (error) {
      throw new UnauthorizedException('JWT decoding failed: ' + error.message);
    }
  },
);
