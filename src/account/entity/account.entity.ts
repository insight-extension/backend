import { ApiProperty } from '@nestjs/swagger';

export class AccountEntity {
  @ApiProperty({
    type: String,
    description: 'Account ID',
  })
  id: string;

  @ApiProperty({
    type: String,
    description: 'Account public key',
  })
  publicKey: string;

  @ApiProperty({
    type: Date,
    description: 'Account created date',
  })
  createdAt: Date;

  @ApiProperty({
    type: Number,
    description: 'Account left free hours per week',
  })
  freeHoursLeft: number;

  @ApiProperty({
    type: Number,
    description: `Account's free hours start using date`,
  })
  freeHoursStartDate: Date | null;
}
