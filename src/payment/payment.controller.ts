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
import { ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('payment')
@UseGuards(JwtAuthGuard)
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @ApiResponse({
    status: 201,
    description: 'Refunds user timed balance',
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('refund/timed-balance')
  async refundUserTimedBalance(
    @Body(new ValidationPipe()) dto: RefundTimedBalanceDto,
  ) {
    return await this.paymentService.refundUserTimedBalance(dto.publicKey);
  }

  @ApiResponse({
    status: 201,
    description: 'Refunds user subscription balance',
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('refund/subscription-balance')
  async refundUserSubscriptionBalance(
    @Body(new ValidationPipe()) dto: RefundSubscriptionBalanceDto,
  ) {
    return await this.paymentService.refundUserSubscriptionBalance(
      dto.publicKey,
    );
  }
}
