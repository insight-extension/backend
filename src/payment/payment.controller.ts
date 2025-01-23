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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtPublicKey } from 'src/utils/decorators/jwt-publickey.decorator';

@ApiTags('payment')
@UseGuards(JwtAuthGuard)
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @ApiOperation({
    summary: 'Refunds user timed balance. Fetching publicKey from JWT',
  })
  @ApiResponse({
    status: 201,
    description: `Returns transaction's signature`,
    type: String,
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @Post('refund/timed-balance')
  async refundUserTimedBalance(
    @JwtPublicKey() publicKey: string,
  ): Promise<string> {
    return await this.paymentService.refundUserTimedBalance(publicKey);
  }

  @ApiOperation({
    summary: 'Refunds user subscription balance. Fetching publicKey from JWT',
  })
  @ApiResponse({
    status: 201,
    description: `Returns transaction's signature`,
    type: String,
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @Post('refund/subscription-balance')
  async refundUserSubscriptionBalance(
    @JwtPublicKey() publicKey: string,
  ): Promise<string> {
    return await this.paymentService.refundUserSubscriptionBalance(publicKey);
  }
}
