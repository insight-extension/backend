import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefundTimedBalanceDto {
  @ApiProperty({
    description: 'Public key of the account',
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  readonly publicKey: string;
}
