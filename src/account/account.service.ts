import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { SaveAccountDto } from './dto/save-account.dto';
import { AccountEntity } from './entity/account.entity';

@Injectable()
export class AccountService {
  constructor(private prisma: PrismaService) {}

  async save(dto: SaveAccountDto): Promise<AccountEntity> {
    return await this.prisma.account.create({
      data: dto,
    });
  }

  async findOneByPublicKey(publicKey: string): Promise<AccountEntity> {
    return await this.prisma.account.findUnique({
      where: {
        publicKey,
      },
    });
  }
}
