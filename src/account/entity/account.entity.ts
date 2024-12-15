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
}
