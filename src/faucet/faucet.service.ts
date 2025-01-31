import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

@Injectable()
export class FaucetService {
  constructor(
    private readonly i18n: I18nService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async claim(publicKey: string, ip: string): Promise<string> {
    console.log('Claiming faucet');
    return 'Claimed';
  }
}
