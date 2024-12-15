import { IsNotEmpty, IsString } from 'class-validator';

export class GetNonceDto {
  @IsString()
  @IsNotEmpty()
  publicKey: string;
}
