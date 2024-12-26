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
    type: Boolean,
    description: 'Account balance freezing status',
  })
  isBalanceFrozen: boolean;

  @ApiProperty({
    type: Number,
    description: 'Account free hours amount per week',
  })
  freeHours: number;

  @ApiProperty({
    type: Number,
    description: `Account's free hours using start date`,
  })
  freeHoursStartDate: Date;
}
