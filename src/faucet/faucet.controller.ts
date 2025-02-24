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
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigureFaucetDto } from './dto/configure-faucet.dto';
import { ConfigureFaucetResponseDto } from './dto/configure-faucet-response.dto';
import { ClaimFaucetResponseDto } from './dto/claim-faucet-response.dto';

@ApiTags('faucet')
@Controller('faucet')
export class FaucetController {
  constructor(private readonly faucetService: FaucetService) {}

  @ApiOperation({
    summary:
      'Allow user to claim USDC. Body is empty, gets publicKey from JWT and IP from request',
  })
  @ApiResponse({
    status: 201,
    description: `Returns transaction's signature`,
    type: ClaimFaucetResponseDto,
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @Post('claim')
  async claim(
    @JwtPublicKey() publicKey: string,
    @Ip() ip: string,
  ): Promise<ClaimFaucetResponseDto> {
    return await this.faucetService.claim(publicKey, ip);
  }

  @ApiOperation({
    summary:
      'Allow to configure the amount of USDC to claim per 24h. Requires API auth token',
  })
  @ApiResponse({
    status: 201,
    description: `Returns transaction's signature`,
    type: ConfigureFaucetResponseDto,
  })
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @Post('configure')
  async configureFaucet(
    @Body() dto: ConfigureFaucetDto,
  ): Promise<ConfigureFaucetResponseDto> {
    return await this.faucetService.configureFaucet(dto.amount);
  }
}
