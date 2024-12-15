import { CanActivate, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import 'dotenv/config';
import { Observable } from 'rxjs';
import { AccountService } from 'src/account/account.service';
@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private accountService: AccountService,
  ) {}

  canActivate(
    context: any,
  ): boolean | any | Promise<boolean | any> | Observable<boolean | any> {
    // Get bearer token from headers
    const bearerToken =
      context.args[0].handshake.headers.authorization.split(' ')[1];
    try {
      // Get decoded payload from bearer token
      const payload = this.jwtService.verify(bearerToken, {
        secret: process.env.JWT_SECRET,
      }) as any;
      // Check if user exists
      return new Promise((resolve, reject) => {
        return this.accountService
          .findOneByPublicKey(payload.publicKey)
          .then((user) => {
            if (user) {
              resolve(user);
            } else {
              reject(false);
            }
          });
      });
    } catch (ex) {
      return false;
    }
  }
}
