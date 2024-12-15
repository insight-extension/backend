import { IsNotEmpty, IsString } from 'class-validator';

export class SaveAccountDto {
  @IsNotEmpty()
  @IsString()
  publicKey: string;
}
