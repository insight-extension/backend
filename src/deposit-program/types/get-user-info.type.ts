import { BN } from '@coral-xyz/anchor';

export type GetUserInfo = {
  perHourLeft: BN;
  isBalanceFrozen: boolean;
  bump: number;
};
