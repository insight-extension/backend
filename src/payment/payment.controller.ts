import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { RefundTimedBalanceDto } from './dto/refund-timed-balance.dto';
import { RefundSubscriptionBalanceDto } from './dto/refund-subscription-balance.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('payment')
@UseGuards(JwtAuthGuard)
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @ApiOperation({ summary: 'Refunds user timed balance' })
  @ApiResponse({
    status: 201,
    description: `Returns transaction's signature`,
    type: String,
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('refund/timed-balance')
  async refundUserTimedBalance(
    @Body() dto: RefundTimedBalanceDto,
  ): Promise<string> {
    return await this.paymentService.refundUserTimedBalance(dto.publicKey);
  }

  @ApiOperation({ summary: 'Refunds user subscription balance' })
  @ApiResponse({
    status: 201,
    description: `Returns transaction's signature`,
    type: String,
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('refund/subscription-balance')
  async refundUserSubscriptionBalance(
    @Body() dto: RefundSubscriptionBalanceDto,
  ): Promise<string> {
    return await this.paymentService.refundUserSubscriptionBalance(
      dto.publicKey,
    );
  }
}
