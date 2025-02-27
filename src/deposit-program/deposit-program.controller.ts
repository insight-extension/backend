import {
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { DepositProgramService } from './deposit-program.service';
import { UnfreezeBalanceDto } from './dto/unfreeze-balance.dto';
import { UnfreezeBalanceResponseDto } from './dto/unfreeze-balance-response.dto';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DepositProgramRoutes } from './constants/deposit-program-routes.enum';
import { HttpHeaders } from 'src/utils/constants/http-headers.enum';

@ApiTags(DepositProgramRoutes.ROOT)
@Controller(DepositProgramRoutes.ROOT)
export class DepositProgramController {
  constructor(private readonly depositProgramService: DepositProgramService) {}
  // TODO: rewrite swagger and move controllers and endpoints constants to enums
  @ApiOperation({
    summary: 'Unfreezes user balance. Accessible only for admin.',
  })
  @ApiBearerAuth()
  @ApiHeader({
    name: HttpHeaders.AUTHORIZATION,
    description: 'Admin auth token. Bearer [token]',
  })
  @ApiBody({
    type: UnfreezeBalanceDto,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: `Returns transaction's signature`,
    type: UnfreezeBalanceResponseDto,
  })
  @HttpCode(HttpStatus.CREATED)
  @Post(DepositProgramRoutes.UNFREEZE_BALANCE)
  async unfreezeBalance(
    dto: UnfreezeBalanceDto,
  ): Promise<UnfreezeBalanceResponseDto> {
    return await this.depositProgramService.unfreezeBalance(dto.publicKey);
  }
}
