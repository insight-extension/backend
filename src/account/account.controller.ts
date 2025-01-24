import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetFreeHoursInfoResponseDto } from './dto/get-free-hours-info-response.dto';
import { JwtPublicKey } from 'src/utils/decorators/jwt-publickey.decorator';

@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(private accountService: AccountService) {}
  @ApiResponse({
    status: 200,
    description: 'Returns the free hours info. Fetching public key from JWT.',
    type: GetFreeHoursInfoResponseDto,
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Get('free-hours-info/')
  async getFreeHoursInfo(
    @JwtPublicKey() publicKey: string,
  ): Promise<GetFreeHoursInfoResponseDto> {
    try {
      return await this.accountService.getFreeHoursInfo(publicKey);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
