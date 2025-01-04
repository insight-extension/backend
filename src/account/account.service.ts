import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SaveAccountDto } from './dto/save-account.dto';
import { AccountEntity } from './entity/account.entity';

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

  async getBalanceFreezingStatus(userPublicKey: string): Promise<boolean> {
    const account = await this.findOneByPublicKey(userPublicKey);
    return account.isBalanceFrozen;
  }

  async setBalanceFreezingStatus(
    status: boolean,
    userPublicKey: string,
  ): Promise<void> {
    await this.prisma.account.update({
      where: {
        publicKey: userPublicKey,
      },
      data: {
        isBalanceFrozen: status,
      },
    });
  }

  async getFreeHours(userPublicKey: string): Promise<number> {
    const account = await this.findOneByPublicKey(userPublicKey);
    return account.freeHoursLeft;
  }

  async setFreeHours(hours: number, userPublicKey: string): Promise<void> {
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
    const account = await this.findOneByPublicKey(userPublicKey);
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

  async setPerHoursLeft(hours: number, userPublicKey: string): Promise<void> {
    await this.prisma.account.update({
      where: {
        publicKey: userPublicKey,
      },
      data: {
        perHoursLeft: hours,
      },
    });
  }

  async getPerHoursLeft(userPublicKey: string): Promise<number> {
    const account = await this.findOneByPublicKey(userPublicKey);
    return account.perHoursLeft;
  }
}
