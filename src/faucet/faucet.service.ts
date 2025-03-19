import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Cache } from 'cache-manager';
import {
  AnchorProvider,
  Program,
  setProvider,
  Wallet,
} from '@coral-xyz/anchor';
import * as idl from './idl/insight_faucet.json';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { InsightFaucet } from './idl/insight_faucet';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ConfigureFaucetResponseDto } from './dto/configure-faucet-response.dto';
import { ClaimFaucetResponseDto } from './dto/claim-faucet-response.dto';
import 'dotenv/config';
import { FaucetCache } from './constants/faucet-cache.enum';

@Injectable()
export class FaucetService {
  private readonly logger = new Logger(FaucetService.name);
  private readonly anchorProvider: AnchorProvider;
  private readonly connection: Connection;
  private readonly program: Program<InsightFaucet>;
  private readonly anchorProviderWallet: Wallet;
  private readonly master: Keypair;
  private readonly TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
  private readonly TOKEN_ADDRESS = new PublicKey(process.env.TOKEN_ADDRESS);
  constructor(
    private readonly i18n: I18nService,
    // cacheManager<key: string(ip), value: Date(renewDate)>
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    // Setup program
    this.master = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(process.env.MASTER_KEY ?? '')),
    );
    this.connection = new Connection(process.env.RPC_URL, 'confirmed');
    this.anchorProviderWallet = new Wallet(this.master);
    this.anchorProvider = new AnchorProvider(
      this.connection,
      this.anchorProviderWallet,
      AnchorProvider.defaultOptions(),
    );
    setProvider(this.anchorProvider);
    this.program = new Program(idl as InsightFaucet, this.anchorProvider);
  }

  async claim(publicKey: string, ip: string): Promise<ClaimFaucetResponseDto> {
    try {
      // Check if the IP address has already claimed the faucet
      const key = FaucetCache.PREFIX + ip;
      const isoRenewDate: string = await this.cacheManager.get(key);

      // If the IP address has already claimed the faucet, throw an error
      if (isoRenewDate) {
        const cachedRenewDate = new Date(isoRenewDate);
        const availableInMs = cachedRenewDate.getTime() - Date.now();
        const availableInHours = Math.ceil(availableInMs / (60 * 60 * 1000)); // min * sec * ms
        this.logger.warn(
          `Public key: [${publicKey}] has already claimed the faucet. The next claim will be available in ${availableInHours} hours`,
        );
        throw new ForbiddenException(
          this.i18n.t('faucet.alreadyClaimed', {
            args: { availableInHours },
          }),
        );
      }

      // Claim the faucet and return the transaction signature
      const transaction = await this.claimUsdcThroughProgram(publicKey);
      this.logger.debug(`[${publicKey}] claimed the faucet: [${transaction}]`);

      const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

      // Set the date then renew will be available
      const renewDate = new Date(Date.now() + ONE_DAY_IN_MS).toISOString();

      // Set the IP address to limit claiming from the faucet
      await this.cacheManager.set(key, renewDate, ONE_DAY_IN_MS);
      this.logger.debug(
        `IP address has been set to cache for ip: [${ip}] public key: [${publicKey}]`,
      );
      return { signature: transaction };
    } catch (error) {
      this.logger.warn('Failed to claim a faucet: ', error);
      throw new ForbiddenException(error.message);
    }
  }

  // Configure the faucet sum that can be claimed per day
  async configureFaucet(
    rawAmountToClaimPerDay: number,
  ): Promise<ConfigureFaucetResponseDto> {
    try {
      const transaction = await this.program.methods
        .initialize(new anchor.BN(rawAmountToClaimPerDay))
        .accounts({
          token: this.TOKEN_ADDRESS,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([this.master])
        .rpc();
      this.logger.log(`Faucet has been configured: [${transaction}]`);
      return { transaction };
    } catch (error) {
      this.logger.error(`Error configuring the faucet: [${error}]`);
      throw new BadRequestException(`Transaction failed: ${error.message}`);
    }
  }

  private async claimUsdcThroughProgram(publicKey: string): Promise<string> {
    try {
      const transaction = await this.program.methods
        .claim()
        .accounts({
          to: new PublicKey(publicKey),
          token: this.TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
        })
        .signers([this.master])
        .rpc();
      return transaction;
    } catch (error) {
      throw new BadRequestException(`Transaction failed: ${error.message}`);
    }
  }

  private async deleteIpFromCache(ip: string): Promise<void> {
    await this.cacheManager.del(FaucetCache.PREFIX + ip);
    this.logger.debug(`IP address has been removed from cache: [${ip}]`);
  }
}
