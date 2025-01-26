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

  async getFreeHours(userPublicKey: string): Promise<number> {
    const account: AccountEntity = await this.findOneByPublicKey(userPublicKey);
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
    const account: AccountEntity = await this.findOneByPublicKey(userPublicKey);
    return account.perHoursLeft;
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
}
