import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, Min } from 'class-validator';

export class RefundBalanceAmountDto {
  @ApiProperty({
    description: 'Amount of raw tokens to refund',
    type: Number,
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  amount: number;
}
