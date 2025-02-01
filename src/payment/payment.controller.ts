import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtPublicKey } from 'src/utils/decorators/jwt-publickey.decorator';
import { RefundBalanceDto } from './dto/refund-balance.dto';

@ApiTags('payment')
@UseGuards(JwtAuthGuard)
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @ApiOperation({
    summary:
      'Refunds user timed balance. Body is empty, gets publicKey from JWT',
  })
  @ApiResponse({
    status: 201,
    description: `Returns transaction's signature`,
    type: String,
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @Post('refund-balance')
  async refundUserBalance(
    @JwtPublicKey() publicKey: string,
    @Body() dto: RefundBalanceDto,
  ): Promise<string> {
    return await this.paymentService.refundUserBalance(publicKey, dto.amount);
  }
}
