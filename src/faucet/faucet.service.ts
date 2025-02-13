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
import * as idl from './interfaces/insight_faucet.json';
import * as anchor from '@coral-xyz/anchor';
import { clusterApiUrl, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { InsightFaucet } from './interfaces/insight_faucet';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

@Injectable()
export class FaucetService {
  private readonly logger = new Logger(FaucetService.name);
  private readonly anchorProvider: AnchorProvider;
  private readonly connection: Connection;
  private readonly program: Program<InsightFaucet>;
  private readonly anchorProviderWallet: Wallet;
  private readonly master: Keypair;
  private readonly TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
  private readonly USDC_TOKEN_ADDRESS = new PublicKey(
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  );
  private readonly RAW_SUM_TO_CLAIM_PER_DAY = 10_000_000;
  constructor(
    private readonly i18n: I18nService,
    // cacheManager<key: string(ip), value: Date(renewDate)>
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    // Setup program
    this.master = Keypair.fromSecretKey(
      new Uint8Array(JSON.parse(process.env.MASTER_KEY ?? '')),
    );
    this.connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
    this.anchorProviderWallet = new Wallet(this.master);
    this.anchorProvider = new AnchorProvider(
      this.connection,
      this.anchorProviderWallet,
      AnchorProvider.defaultOptions(),
    );
    setProvider(this.anchorProvider);
    this.program = new Program(idl as InsightFaucet, this.anchorProvider);

    // Configure the faucet
    // this.configureFaucet(this.RAW_SUM_TO_CLAIM_PER_DAY);
  }

  // TODO: Improve error handling. We should also check if the public key
  // has already claimed the faucet and handle the error if the transaction fails.
  async claim(publicKey: string, ip: string): Promise<string> {
    try {
      // Check if the IP address has already claimed the faucet
      const cachedRenewDate: Date | undefined = await this.cacheManager.get(ip);

      // If the IP address has already claimed the faucet, throw an error
      if (cachedRenewDate) {
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
      const renewDate = new Date(Date.now() + ONE_DAY_IN_MS);

      // Set the IP address to limit claiming from the faucet
      await this.cacheManager.set(ip, renewDate, ONE_DAY_IN_MS);
      this.logger.debug(
        `IP address has been set to cache for ip: [${ip}] public key: [${publicKey}]`,
      );
      return transaction;
    } catch (error) {
      this.logger.warn('Failed to claim a faucet: ', error);
      throw new ForbiddenException(error.message);
    }
  }

  private async claimUsdcThroughProgram(publicKey: string): Promise<string> {
    try {
      const tx = await this.program.methods
        .claim()
        .accounts({
          to: new PublicKey(publicKey),
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: this.TOKEN_PROGRAM,
        })
        .signers([this.master])
        .rpc();
      return tx;
    } catch (error) {
      throw new BadRequestException(`Transaction failed: ${error.message}`);
    }
  }

  // Configure the faucet sum that can be claimed per day
  private async configureFaucet(rawSumToClaimPerDay: number): Promise<string> {
    try {
      const tx = await this.program.methods
        .initialize(new anchor.BN(rawSumToClaimPerDay))
        .accounts({
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([this.master])
        .rpc();
      this.logger.log(`Faucet has been configured: [${tx}]`);
      return tx;
    } catch (error) {
      this.logger.error(`Error configuring the faucet: [${error}]`);
    }
  }
}
