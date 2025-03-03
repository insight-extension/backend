import { ApiProperty } from '@nestjs/swagger';

export class UnfreezeBalanceResponseDto {
  @ApiProperty()
  transaction: string;
}
