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
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';

@Injectable()
export class FaucetService {
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
    this.configureFaucet(this.RAW_SUM_TO_CLAIM_PER_DAY);
  }

  async claim(publicKey: string, ip: string): Promise<string> {
    try {
      // Check if the IP address has already claimed the faucet
      const cachedRenewDate = await this.cacheManager.get(ip);
      if (cachedRenewDate) {
        throw new ForbiddenException(
          this.i18n.t('faucet.alreadyClaimed', {
            args: { date: cachedRenewDate },
          }),
        );
      }

      // Claim the faucet and return the transaction signature
      const transaction = await this.claimThroughProgram(publicKey);
      Logger.log(`Faucet has been claimed: [${transaction}]`);

      // Set the IP address to limit claiming from the faucet
      const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
      const renewDate = new Date(Date.now() + ONE_DAY_IN_MS);
      await this.cacheManager.set(ip, renewDate, ONE_DAY_IN_MS);
      Logger.log(
        `IP address has been set to cache for ip: [${ip}] public key: [${publicKey}]`,
      );

      return transaction;
    } catch (error) {
      Logger.warn('Failed to claim a faucet: ', error);
      throw new ForbiddenException(error.message);
    }
  }

  private async claimThroughProgram(publicKey: string): Promise<string> {
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
      Logger.warn('Failed to claim a faucet: ', error);
      throw new BadRequestException(error.message);
    }
  }

  private async configureFaucet(RawSumToClaimPerDay: number): Promise<string> {
    try {
      const tx = await this.program.methods
        .initialize(new anchor.BN(RawSumToClaimPerDay))
        .accounts({
          token: this.USDC_TOKEN_ADDRESS,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([this.master])
        .rpc();
      Logger.log(`Faucet has been configured: [${tx}]`);
      return tx;
    } catch (error) {
      Logger.error(error);
    }
  }
}
