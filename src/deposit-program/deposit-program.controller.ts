import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { DepositProgramService } from './deposit-program.service';
import { UnfreezeBalanceDto } from './dto/unfreeze-balance.dto';
import { UnfreezeBalanceResponseDto } from './dto/unfreeze-balance-response.dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('deposit-program')
export class DepositProgramController {
  constructor(private readonly depositProgramService: DepositProgramService) {}
  // TODO: rewrite swagger and move controllers and endpoints constants to enums
  @ApiOperation({
    summary: 'Unfreezes user balance',
  })
  @ApiResponse({
    status: 201,
    description: `Returns transaction's signature`,
    type: UnfreezeBalanceDto,
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('unfreeze-balance')
  async unfreezeBalance(
    dto: UnfreezeBalanceDto,
  ): Promise<UnfreezeBalanceResponseDto> {
    return await this.depositProgramService.unfreezeBalance(dto.publicKey);
  }
}
