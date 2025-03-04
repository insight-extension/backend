import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { AccountModule } from 'src/account/account.module';
import { WsJwtGuard } from './guards/jwt-ws.guard';
import 'dotenv/config';

@Module({
  imports: [
    AccountModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
    }),
  ],
  providers: [AuthService, JwtStrategy, WsJwtGuard],
  controllers: [AuthController],
  exports: [WsJwtGuard, JwtModule, AuthService],
})
export class AuthModule {}
