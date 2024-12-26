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

  async setBalanceFreezingStatus(status: boolean, userPublicKey: string) {
    this.prisma.account.update({
      where: {
        publicKey: userPublicKey,
      },
      data: {
        isBalanceFrozen: status,
      },
    });
  }
}
