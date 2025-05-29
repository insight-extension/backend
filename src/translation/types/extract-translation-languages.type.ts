import { TranslationLanguages } from '../constants/translation-languages.enum';

export type ExtractTranslationLanguages = {
  sourceLang: TranslationLanguages;
  targetLang: TranslationLanguages;
};
