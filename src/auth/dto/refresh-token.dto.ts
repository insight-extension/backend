import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token',
    type: String,
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
