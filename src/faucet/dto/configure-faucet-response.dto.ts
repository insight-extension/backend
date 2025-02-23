import { ApiProperty } from '@nestjs/swagger';

export class ConfigureFaucetResponseDto {
  @ApiProperty()
  transaction: string;
}
