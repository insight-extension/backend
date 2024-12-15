import { Module } from '@nestjs/common';
import { TranslationGateway } from './translation.gateway';
import { AccountModule } from 'src/account/account.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  providers: [TranslationGateway],
  imports: [AccountModule, AuthModule],
})
export class TranslationModule {}
