import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyDto {
  @ApiProperty({
    description: 'Public key of the account',
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  @Length(32, 44)
  publicKey: string;

  @ApiProperty({
    description: 'Signature of the account',
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  signature: string;
}
