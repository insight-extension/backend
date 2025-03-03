import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { VerifyDto } from './dto/verify.dto';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ClaimNonceDto } from './dto/claim-nonce.dto';
import 'dotenv/config';
import { RefreshTokenResponseDto } from './dto/refresh-token-response.dto';
import { VerifyResponseDto } from './dto/verify-response.dto';
import { ClaimNonceResponseDto } from './dto/claim-nonce-response.dto';
import { AuthRoutes } from './constants/auth-routes.enum';

@ApiTags(AuthRoutes.ROOT)
@Controller(AuthRoutes.ROOT)
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiOperation({
    summary:
      'Generates a nonce for the given public key to proceed with the login flow.',
  })
  @ApiBody({
    type: ClaimNonceDto,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Returns a nonce that should be signed.',
    type: ClaimNonceResponseDto,
  })
  @HttpCode(HttpStatus.CREATED)
  @Post(AuthRoutes.CLAIM)
  async claim(@Body() dto: ClaimNonceDto): Promise<ClaimNonceResponseDto> {
    return this.authService.claimNonce(dto);
  }

  @ApiOperation({
    summary:
      'Verifies the provided signature. If the account does not exist, it will be created.',
  })
  @ApiBody({
    type: VerifyDto,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Returns access and refresh tokens.',
    type: VerifyResponseDto,
  })
  @HttpCode(HttpStatus.CREATED)
  @Post(AuthRoutes.VERIFY)
  async verify(@Body() dto: VerifyDto): Promise<VerifyResponseDto> {
    return this.authService.verify(dto);
  }

  @ApiOperation({
    summary:
      'Generates a new access and refresh token by provided refresh token.',
  })
  @ApiBody({
    type: RefreshTokenDto,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Returns a new access and refresh token .',
    type: RefreshTokenResponseDto,
  })
  @HttpCode(HttpStatus.CREATED)
  @Post(AuthRoutes.REFRESH_TOKEN)
  async refreshToken(
    @Body() dto: RefreshTokenDto,
  ): Promise<RefreshTokenResponseDto> {
    return this.authService.refreshToken(dto.refreshToken);
  }
}
