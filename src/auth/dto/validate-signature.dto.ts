import { IsNotEmpty, IsString } from 'class-validator';
import { IsSolPubkey } from 'src/utils/decorators/is-sol-pubkey.decorator';

export class ValidateSignatureDto {
  @IsString()
  @IsSolPubkey()
  publicKey: string;

  @IsString()
  @IsNotEmpty()
  signature: string;
}
