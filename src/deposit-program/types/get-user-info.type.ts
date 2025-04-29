import { BN } from '@coral-xyz/anchor';

export type UserInfo = {
  perHourLeft: BN;
  isBalanceFrozen: boolean;
  bump: number;
  subscriptionEndsAt: BN;
};
