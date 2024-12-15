import { IsNotEmpty, IsString } from 'class-validator';

export class ValidateSignatureDto {
  @IsString()
  @IsNotEmpty()
  publicKey: string;

  @IsString()
  @IsNotEmpty()
  signature: string;
}
