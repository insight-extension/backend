import { Controller, Ip, Post, UseGuards } from '@nestjs/common';
import { FaucetService } from './faucet.service';
import { JwtPublicKey } from 'src/utils/decorators/jwt-publickey.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@Controller('faucet')
export class FaucetController {
  constructor(private readonly faucetService: FaucetService) {}

  @Post('claim')
  @UseGuards(JwtAuthGuard)
  async claim(
    @JwtPublicKey() publicKey: string,
    @Ip() ip: string,
  ): Promise<string> {
    return await this.faucetService.claim(publicKey, ip);
  }
}
