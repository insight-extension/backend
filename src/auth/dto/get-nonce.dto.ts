import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { IsSolPubkey } from 'src/utils/decorators/is-sol-pubkey.decorator';

export class GetNonceDto {
  @ApiProperty({
    description: 'Public key of the account',
    type: String,
  })
  @IsString()
  @IsSolPubkey()
  publicKey: string;
}
