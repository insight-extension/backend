import { ApiProperty } from '@nestjs/swagger';

export class ClaimNonceResponseDto {
  @ApiProperty()
  publicKey: string;
  @ApiProperty()
  nonce: string;
}
