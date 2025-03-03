import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class ConfigureFaucetDto {
  @ApiProperty({
    description: 'Raw amount to claim per day',
    type: Number,
  })
  @IsNumber()
  @Min(0)
  amount: number;
}
