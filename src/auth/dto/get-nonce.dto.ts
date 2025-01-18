import { IsString } from 'class-validator';
import { IsSolPubkey } from 'src/utils/decorators/is-sol-pubkey.decorator';

export class GetNonceDto {
  @IsString()
  @IsSolPubkey()
  publicKey: string;
}
