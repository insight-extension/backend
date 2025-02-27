import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { Keypair } from '@solana/web3.js';
import { AuthService } from 'src/auth/auth.service';
import * as nacl from 'tweetnacl';

export const APP_URL = `http://localhost:${process.env.API_PORT}/`;

export async function getAccessToken(
  authService: AuthService,
  user: Keypair,
): Promise<string> {
  const { nonce } = await authService.claimNonce({
    publicKey: user.publicKey.toString(),
  });
  const messageBuffer = new TextEncoder().encode(nonce);
  const signature = bs58.encode(
    nacl.sign.detached(messageBuffer, user.secretKey),
  );
  const { accessToken } = await authService.verify({
    publicKey: user.publicKey.toString(),
    signature,
  });
  return accessToken;
}
