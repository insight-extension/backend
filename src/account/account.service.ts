import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SaveAccountDto } from './dto/save-account.dto';
import { AccountEntity } from './entity/account.entity';
import { GetFreeHoursInfoResponseDto } from './dto/get-free-hours-info-response.dto';

@Injectable()
export class AccountService {
  constructor(private prisma: PrismaService) {}

  async saveAccount(dto: SaveAccountDto): Promise<AccountEntity> {
    return await this.prisma.account.create({
      data: dto,
    });
  }

  async findOneByPublicKey(userPublicKey: string): Promise<AccountEntity> {
    return await this.prisma.account.findUnique({
      where: {
        publicKey: userPublicKey,
      },
    });
  }

  async getFreeHoursLeft(userPublicKey: string): Promise<number> {
    const account: AccountEntity = await this.findOneByPublicKey(userPublicKey);
    return account.freeHoursLeft;
  }

  async setFreeHoursLeft(hours: number, userPublicKey: string): Promise<void> {
    await this.prisma.account.update({
      where: {
        publicKey: userPublicKey,
      },
      data: {
        freeHoursLeft: hours,
      },
    });
  }

  async getFreeHoursStartDate(userPublicKey: string): Promise<Date | null> {
    const account: AccountEntity = await this.findOneByPublicKey(userPublicKey);
    return account.freeHoursStartDate;
  }

  async setFreeHoursStartDate(
    newDate: Date,
    userPublicKey: string,
  ): Promise<void> {
    await this.prisma.account.update({
      where: {
        publicKey: userPublicKey,
      },
      data: {
        freeHoursStartDate: newDate,
      },
    });
  }

  async getFreeHoursInfo(
    userPublicKey: string,
  ): Promise<GetFreeHoursInfoResponseDto> {
    const account: AccountEntity = await this.findOneByPublicKey(userPublicKey);
    return {
      freeHoursLeft: account.freeHoursLeft,
      freeHoursStartDate: account.freeHoursStartDate,
    };
  }

  async deleteAccount(userPublicKey: string): Promise<void> {
    await this.prisma.account.delete({
      where: {
        publicKey: userPublicKey,
      },
    });
  }

  async deleteManyAccounts(accounts: string[]): Promise<void> {
    await this.prisma.account.deleteMany({
      where: {
        publicKey: { in: accounts },
      },
    });
  }
}
