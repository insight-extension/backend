import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { VerifyDto } from './dto/verify.dto';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ClaimNonceDto } from './dto/claim-nonce.dto';
import 'dotenv/config';
import { RefreshTokenResponseDto } from './dto/refresh-token-response.dto';
import { VerifyResponseDto } from './dto/verify-response.dto';
import { ClaimNonceResponseDto } from './dto/claim-nonce-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiResponse({
    status: 201,
    description:
      'Generates a nonce for the given public key to proceed with the login flow.',
    type: ClaimNonceResponseDto,
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('claim')
  async claim(@Body() dto: ClaimNonceDto): Promise<ClaimNonceResponseDto> {
    return this.authService.claimNonce(dto);
  }

  @ApiResponse({
    status: 201,
    description:
      'Verifies the provided signature and returns access and refresh tokens. If the account does not exist, it will be created.',
    type: VerifyResponseDto,
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('verify')
  async verify(@Body() dto: VerifyDto): Promise<VerifyResponseDto> {
    return this.authService.verify(dto);
  }

  @ApiResponse({
    status: 201,
    description:
      'Generates a new access and refresh token for the given public key.',
    type: RefreshTokenResponseDto,
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('refresh-token')
  async refreshToken(
    @Body() dto: RefreshTokenDto,
  ): Promise<RefreshTokenResponseDto> {
    return this.authService.refreshToken(dto.refreshToken);
  }
}
