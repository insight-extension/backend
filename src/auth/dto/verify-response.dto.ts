import { ApiProperty } from '@nestjs/swagger';

export class VerifyResponseDto {
  @ApiProperty()
  accessToken: string;
  @ApiProperty()
  refreshToken: string;
}
