import { BN } from '@coral-xyz/anchor';
import { Injectable } from '@nestjs/common';
import { Keypair, PublicKey } from '@solana/web3.js';
import { DepositProgramAccountType } from 'src/deposit-program/constants/account-type.enum';
import { UnfreezeBalanceResponseDto } from 'src/deposit-program/dto/unfreeze-balance-response.dto';
import { GetUserInfo } from 'src/deposit-program/types/get-user-info.type';
import { sleep } from './payment.helper';

@Injectable()
export class MockDepositProgramService {
  private readonly timeToSleep = 1500;
  public readonly mockedTransaction = 'tx123';

  // Available to change during the tests
  public isBalanceFrozen = false;
  public perHourLeft: number = 0;
  public userBalance: BN = new BN(0);

  getUserInfoAddress = jest.fn(
    (
      infoAccountType: DepositProgramAccountType,
      userPublicKey: string,
    ): PublicKey => {
      return Keypair.generate().publicKey;
    },
  );

  getUserInfo = jest.fn(
    async (userInfoAddress: PublicKey): Promise<GetUserInfo> => {
      sleep(this.timeToSleep);
      return {
        perHourLeft: new BN(this.perHourLeft),
        isBalanceFrozen: this.isBalanceFrozen,
        bump: 123,
      };
    },
  );

  getUserVaultBalance = jest.fn(
    async (userVaultAddress: PublicKey): Promise<number> => {
      sleep(this.timeToSleep);
      return this.userBalance;
    },
  );

  getUserVaultAddress = jest.fn(
    async (userInfoAddress: PublicKey): Promise<PublicKey> => {
      sleep(this.timeToSleep);
      return Keypair.generate().publicKey;
    },
  );

  payPerMinute = jest.fn(
    async (userPublicKey: string, rawPrice: number): Promise<void> => {
      sleep(this.timeToSleep);
      const balance = this.userBalance.toNumber() - rawPrice;
      this.userBalance = new BN(balance);
      this.isBalanceFrozen = false;
    },
  );

  payPerHour = jest.fn(
    async (
      userPublicKey: string,
      rawTotalPrice: number,
      perHoursLeft: number,
    ): Promise<void> => {
      sleep(this.timeToSleep);
      const balance = this.userBalance.toNumber() - rawTotalPrice;
      this.userBalance = new BN(balance);
      this.perHourLeft = perHoursLeft;
      this.isBalanceFrozen = false;
    },
  );

  refundBalance = jest.fn(
    async (userPublicKey: string, rawTotalPrice: number): Promise<string> => {
      sleep(this.timeToSleep);
      this.userBalance = new BN(0);
      return this.mockedTransaction;
    },
  );

  freezeBalance = jest.fn(async (userPublicKey: string): Promise<string> => {
    sleep(this.timeToSleep);
    this.isBalanceFrozen = true;
    return this.mockedTransaction;
  });

  unfreezeBalance = jest.fn(
    async (userPublicKey: string): Promise<UnfreezeBalanceResponseDto> => {
      sleep(this.timeToSleep);
      this.isBalanceFrozen = false;
      return { transaction: this.mockedTransaction };
    },
  );

  setUserBalance = (balance: number): void => {
    this.userBalance = new BN(balance);
  };

  clearState(): void {
    this.isBalanceFrozen = false;
    this.perHourLeft = 0;
    this.userBalance = new BN(0);
  }
}
