import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { IsSolPubkey } from 'src/utils/decorators/is-sol-pubkey.decorator';

export class UnfreezeBalanceDto {
  @ApiProperty({
    description: 'Public key of the account to unfreeze',
    type: String,
  })
  @IsSolPubkey()
  publicKey: string;
}
