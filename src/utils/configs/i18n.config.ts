import { I18nModule } from 'nestjs-i18n';
import * as path from 'path';
import { AcceptLanguageResolver } from 'nestjs-i18n';

export const I18nConfig = I18nModule.forRoot({
  fallbackLanguage: 'en',
  loaderOptions: {
    path: path.join(__dirname, '../../i18n/'),
    watch: true,
  },
  resolvers: [AcceptLanguageResolver],
});
