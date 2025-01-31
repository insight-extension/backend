import { Controller, Ip, Post } from '@nestjs/common';
import { FaucetService } from './faucet.service';
import { JwtPublicKey } from 'src/utils/decorators/jwt-publickey.decorator';

@Controller('faucet')
export class FaucetController {
  constructor(private readonly faucetService: FaucetService) {}
  @Post('claim')
  async claim(
    @JwtPublicKey() publicKey: string,
    @Ip() ip: string,
  ): Promise<string> {
    return await this.faucetService.claim(publicKey, ip);
  }
}
