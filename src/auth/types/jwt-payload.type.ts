// Our custom jwt token's payload type
export type JwtPayload = {
  publicKey: string;
  iat: number;
  exp: number;
};
