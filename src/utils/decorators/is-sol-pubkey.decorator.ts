import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { PublicKey } from '@solana/web3.js';

/*
  Validate is string correct Solana public key on curve
*/

@ValidatorConstraint({ async: false })
export class IsSolPubkeyConstraint implements ValidatorConstraintInterface {
  validate(address: string, args: ValidationArguments): boolean {
    try {
      const pubkey = new PublicKey(address);
      return PublicKey.isOnCurve(pubkey.toBuffer());
    } catch (error) {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a valid Solana address on the curve`;
  }
}

export function IsSolPubkey(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsSolPubkeyConstraint,
    });
  };
}
