import { Module } from '@nestjs/common';
import { AccountService } from './account.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountController } from './account.controller';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [PrismaModule],
  providers: [AccountService],
  exports: [AccountService],
  controllers: [AccountController],
})
export class AccountModule {}
