import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsSolPubkey } from 'src/utils/decorators/is-sol-pubkey.decorator';

export class VerifyDto {
  @ApiProperty({
    description: 'Public key of the account',
    type: String,
  })
  @IsString()
  @IsSolPubkey()
  publicKey: string;

  @ApiProperty({
    description: 'Signature of the account',
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  signature: string;
}
