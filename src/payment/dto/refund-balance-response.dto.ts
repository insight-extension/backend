import { ApiProperty } from '@nestjs/swagger';

export class RefundBalanceResponseDto {
  @ApiProperty()
  signature: string;
}
