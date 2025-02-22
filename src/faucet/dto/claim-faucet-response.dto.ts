import { ApiProperty } from '@nestjs/swagger';

export class ClaimFaucetResponseDto {
  @ApiProperty()
  signature: string;
}
