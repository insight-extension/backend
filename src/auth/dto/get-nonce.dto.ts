import { IsNotEmpty, IsString, Length } from 'class-validator';

export class GetNonceDto {
  @IsString()
  @IsNotEmpty()
  @Length(32, 44)
  publicKey: string;
}
