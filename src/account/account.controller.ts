import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetFreeHoursInfoResponseDto } from './dto/get-free-hours-info-response.dto';

@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(private accountService: AccountService) {}

  @ApiParam({
    name: 'publicKey',
    required: true,
    description: 'Account public key',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the free hours info for the given account.',
    type: GetFreeHoursInfoResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Get('free-hours-info/:publicKey')
  async getFreeHoursInfo(
    @Param() params: any,
  ): Promise<GetFreeHoursInfoResponseDto> {
    try {
      const publicKey: string = params.publicKey;
      return await this.accountService.getFreeHoursInfo(publicKey);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
