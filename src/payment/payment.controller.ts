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
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtPublicKey } from 'src/utils/decorators/jwt-publickey.decorator';
import { RefundBalanceAmountDto as RefundBalanceDto } from './dto/refund-balance-amount.dto';
import { RefundBalanceResponseDto } from './dto/refund-balance-response.dto';
import { HttpHeaders } from 'src/utils/constants/http-headers.enum';
import { PaymentRoutes } from './constants/payment-routes.enum';

@UseGuards(JwtAuthGuard)
@ApiTags(PaymentRoutes.ROOT)
@Controller(PaymentRoutes.ROOT)
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @ApiOperation({
    summary: 'Refunds user balance. Body is empty, gets publicKey from JWT',
  })
  @ApiBody({
    type: RefundBalanceDto,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: `Returns transaction's signature`,
    type: RefundBalanceResponseDto,
  })
  @ApiBearerAuth()
  @ApiHeader({
    name: HttpHeaders.AUTHORIZATION,
    description: 'JWT access token. Bearer [token]',
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @Post(PaymentRoutes.REFUND_BALANCE)
  async refundUserBalance(
    @JwtPublicKey() publicKey: string,
    @Body() dto: RefundBalanceDto,
  ): Promise<RefundBalanceResponseDto> {
    return await this.paymentService.refundUserBalance(publicKey, dto.amount);
  }
}
