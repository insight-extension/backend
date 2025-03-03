import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { PublicKey } from '@solana/web3.js';
import { I18nService } from 'nestjs-i18n';
import { AppModule } from 'src/app.module';
import { i18n } from '../types/i18n.type';

/*
  Validate is string correct Solana public key on curve
*/
@ValidatorConstraint({ async: false })
export class IsSolPubkeyConstraint implements ValidatorConstraintInterface {
  // Get i18n instance from app
  private readonly i18n = AppModule.moduleRef.get(I18nService<i18n>, {
    strict: false,
  });

  validate(address: unknown, args: ValidationArguments): boolean {
    try {
      const pubkey = new PublicKey(address);
      return PublicKey.isOnCurve(pubkey.toBuffer());
    } catch (error) {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} ${this.i18n.t('utils.decorators.isSolPubkey.defaultMessage')}`;
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
