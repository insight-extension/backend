import { TranslationLanguages } from '../constants/translation-languages.enum';

export type ExtractTranslationLanguages = {
  sourceLanguage: TranslationLanguages;
  targetLanguage: TranslationLanguages;
};
