import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class RefundBalanceDto {
  @ApiProperty({
    description: 'Amount of raw USDC to refund',
    type: Number,
  })
  @IsNumber()
  @IsNotEmpty()
  amount: number;
}
