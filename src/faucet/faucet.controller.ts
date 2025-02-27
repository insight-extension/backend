import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { FaucetService } from './faucet.service';
import { JwtPublicKey } from 'src/utils/decorators/jwt-publickey.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigureFaucetResponseDto } from './dto/configure-faucet-response.dto';
import { ClaimFaucetResponseDto } from './dto/claim-faucet-response.dto';
import { ConfigureFaucetDto } from './dto/configure-faucet.dto';
import { HttpHeaders } from 'src/utils/constants/http-headers.enum';
import { FaucetRoutes } from './constants/faucet-routes.enum';

@ApiTags(FaucetRoutes.ROOT)
@Controller(FaucetRoutes.ROOT)
export class FaucetController {
  constructor(private readonly faucetService: FaucetService) {}
  @ApiOperation({
    summary:
      'Allow user to claim USDC. Body is empty, gets publicKey from JWT and IP from request',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: `Returns transaction's signature`,
    type: ClaimFaucetResponseDto,
  })
  @ApiBearerAuth()
  @ApiHeader({
    name: HttpHeaders.AUTHORIZATION,
    description: 'JWT access token. Bearer [token]',
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @Post(FaucetRoutes.CLAIM)
  async claim(
    @JwtPublicKey() publicKey: string,
    @Ip() ip: string,
  ): Promise<ClaimFaucetResponseDto> {
    return await this.faucetService.claim(publicKey, ip);
  }

  @ApiOperation({
    summary:
      'Allow to configure the amount of USDC to claim per 24h in program. Accessible only for admin',
  })
  @ApiBody({
    type: ConfigureFaucetDto,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: `Returns transaction's signature`,
    type: ConfigureFaucetResponseDto,
  })
  @ApiBearerAuth()
  @ApiHeader({
    name: HttpHeaders.AUTHORIZATION,
    description: 'Admin auth token. Bearer [token]',
  })
  @HttpCode(HttpStatus.CREATED)
  @Post(FaucetRoutes.CONFIGURE)
  async configureFaucet(
    @Body() dto: ConfigureFaucetDto,
  ): Promise<ConfigureFaucetResponseDto> {
    return await this.faucetService.configureFaucet(dto.amount);
  }
}
