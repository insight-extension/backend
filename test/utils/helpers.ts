import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { Keypair } from '@solana/web3.js';
import { AuthService } from 'src/auth/auth.service';
import * as nacl from 'tweetnacl';

export async function getAccessToken(
  authService: AuthService,
  user: Keypair,
): Promise<string> {
  const signature = await getSignature(authService, user);
  const { accessToken } = await verifySignature(authService, user, signature);
  return accessToken;
}

export async function getRefreshToken(
  authService: AuthService,
  user: Keypair,
): Promise<string> {
  const signature = await getSignature(authService, user);
  const { refreshToken } = await verifySignature(authService, user, signature);
  return refreshToken;
}

export async function getSignature(authService: AuthService, user: Keypair) {
  const { nonce } = await authService.claimNonce({
    publicKey: user.publicKey.toString(),
  });
  const messageBuffer = new TextEncoder().encode(nonce);
  const signature = bs58.encode(
    nacl.sign.detached(messageBuffer, user.secretKey),
  );
  return signature;
}

export async function verifySignature(
  authService: AuthService,
  user: Keypair,
  signature: string,
) {
  return await authService.verify({
    publicKey: user.publicKey.toString(),
    signature,
  });
}
