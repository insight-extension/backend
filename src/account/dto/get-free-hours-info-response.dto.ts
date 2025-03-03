import { ApiProperty } from '@nestjs/swagger';
import { IsDate, IsNotEmpty, IsNumber } from 'class-validator';

export class GetFreeHoursInfoResponseDto {
  @ApiProperty({
    description: `Account's free hours left`,
    type: Number,
  })
  @IsNotEmpty()
  @IsNumber()
  freeHoursLeft: number;

  @ApiProperty({
    description: `Account's free hours start using date`,
    type: Date,
  })
  @IsNotEmpty()
  @IsDate()
  freeHoursStartDate: Date | null;
}
