import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { VerifyDto } from './dto/verify.dto';
import { ClaimNonceDto as ClaimNonceDto } from './dto/claim-nonce.dto';
import { randomBytes } from 'crypto';
import { ValidateSignatureDto } from './dto/validate-signature.dto';
import bs58 from 'bs58';
import { sign } from 'tweetnacl';
import { AccountCandidates } from './types/account-candidates.type';
import { GetNonceDto } from './dto/get-nonce.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AccountService } from 'src/account/account.service';
import { I18nService } from 'nestjs-i18n';
import { JwtExpire } from './constants/jwt-expire.enum';
import 'dotenv/config';
import { RefreshTokenResponseDto } from './dto/refresh-token-response.dto';
import { VerifyResponseDto } from './dto/verify-response.dto';
import { ClaimNonceResponseDto } from './dto/claim-nonce-response.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly accountService: AccountService,
    private readonly jwtService: JwtService,
    private readonly i18n: I18nService,
    // cacheManager<key: string(publicKey), value: string(nonce)>
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  // Validate signed signature from client and return jwt tokens
  async verify(dto: VerifyDto): Promise<VerifyResponseDto> {
    const account = await this.validateSignature(dto);
    if (!account) {
      this.logger.error('Invalid signature detected', dto);
      throw new Error(this.i18n.t('auth.invalidSignature'));
    }

    const accountExists = await this.accountService.findOneByPublicKey(
      account.publicKey,
    );
    if (!accountExists) {
      this.accountService.saveAccount(account);
    }

    return {
      accessToken: await this.generateAccessToken({
        publicKey: account.publicKey,
      }),
      refreshToken: await this.generateRefreshToken({
        publicKey: account.publicKey,
      }),
    };
  }

  // Send nonce to client for signing
  async claimNonce(dto: ClaimNonceDto): Promise<ClaimNonceResponseDto> {
    const { publicKey, nonce } = await this.generateNonceForPublicKey({
      publicKey: dto.publicKey,
    });

    return {
      publicKey,
      nonce,
    };
  }

  // Refresh access and refresh tokens by providing refresh token
  async refreshToken(refreshToken: string): Promise<RefreshTokenResponseDto> {
    try {
      // Throws error if token is invalid
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env.JWT_SECRET,
      });

      const newPayload = { publicKey: payload.publicKey };

      return {
        accessToken: await this.generateAccessToken(newPayload),
        refreshToken: await this.generateRefreshToken(newPayload),
      };
    } catch (error) {
      this.logger.error('Invalid refresh token', error);
      throw new ForbiddenException(this.i18n.t('auth.invalidRefreshToken'));
    }
  }

  // Validate signed by client nonce
  private async validateSignature(dto: ValidateSignatureDto) {
    const nonce: string = await this.cacheManager.get(dto.publicKey);
    if (!nonce) {
      this.logger.error(`Nonce not found for publicKey: ${dto.publicKey}`);
      throw new BadRequestException(this.i18n.t('auth.candidateNotFound'));
    }

    const publicKeyUint8 = bs58.decode(dto.publicKey);
    const signatureUint8 = bs58.decode(dto.signature);
    const msgUint8 = new TextEncoder().encode(nonce);

    const isValid = sign.detached.verify(
      msgUint8,
      signatureUint8,
      publicKeyUint8,
    );
    if (!isValid) {
      this.logger.error(`Invalid signature for publicKey: ${dto.publicKey}`);
      throw new BadRequestException(this.i18n.t('auth.invalidSignature'));
    }

    return {
      publicKey: dto.publicKey,
    };
  }

  // Generate a new nonce or return an existing for publickey
  private async generateNonceForPublicKey(
    dto: GetNonceDto,
  ): Promise<AccountCandidates> {
    const existingNonce: string | undefined = await this.cacheManager.get(
      dto.publicKey,
    );
    if (existingNonce) {
      this.logger.debug(`Nonce found for publicKey: ${dto.publicKey}`);
      return {
        publicKey: dto.publicKey,
        nonce: existingNonce,
      };
    }
    const nonce = this.generateNonce();

    // Store nonce for comparing it later
    await this.cacheManager.set(dto.publicKey, nonce);

    return {
      publicKey: dto.publicKey,
      nonce,
    };
  }

  private async generateAccessToken(payload: any): Promise<string> {
    return await this.jwtService.signAsync(payload, {
      expiresIn: `${JwtExpire.ACCESS_TOKEN}`,
    });
  }

  private async generateRefreshToken(payload: any): Promise<string> {
    return await this.jwtService.signAsync(payload, {
      expiresIn: `${JwtExpire.REFRESH_TOKEN}`,
    });
  }

  private generateNonce(): string {
    const payload = randomBytes(32).toString('hex');
    return `insight: ${payload}`;
  }
}
