export interface GlossaryRule {
  arabicPattern: string;
  germanReplacement: string;
}

export const DEFAULT_ISLAMIC_GLOSSARY: GlossaryRule[] = [
  { arabicPattern: 'خطبة', germanReplacement: 'Khutbah' },
  { arabicPattern: 'الخطبة', germanReplacement: 'die Khutbah' },
  { arabicPattern: 'الجمعة', germanReplacement: "Jumu'ah (Freitag)" },
  { arabicPattern: 'التقوى', germanReplacement: 'Taqwa (Gottesfurcht)' },
  { arabicPattern: 'تقوى الله', germanReplacement: 'Taqwa (Gottesfurcht) vor Allah' },
  { arabicPattern: 'السنة', germanReplacement: 'Sunnah' },
  { arabicPattern: 'القرآن', germanReplacement: 'Koran' },
  { arabicPattern: 'الإمام', germanReplacement: 'Imam' },
  { arabicPattern: 'الصلاة', germanReplacement: 'Gebet (Salah)' },
  { arabicPattern: 'الزكاة', germanReplacement: 'Zakah' },
  { arabicPattern: 'رمضان', germanReplacement: 'Ramadan' },
  { arabicPattern: 'الصحابة', germanReplacement: 'Sahaba (Gefährten des Propheten)' },
  { arabicPattern: 'إن شاء الله', germanReplacement: 'in scha Allah' },
  { arabicPattern: 'الحمد لله', germanReplacement: 'Alhamdulillah (Alles Lob gebührt Allah)' },
  { arabicPattern: 'سبحان الله', germanReplacement: 'Subhanallah (Gepriesen sei Allah)' }
];

export function applyIslamicTerminology(
  germanText: string,
  arabicSource: string,
  customRules: GlossaryRule[] = DEFAULT_ISLAMIC_GLOSSARY
): string {
  let result = germanText.trim();

  const postReplacements: Array<[RegExp, string]> = [
    [/\bFreitagspredigt\b/gi, 'Khutbah (Freitagspredigt)'],
    [/\bGottesfurcht\b/gi, 'Taqwa (Gottesfurcht)'],
    [/\bAlmosensteuer\b/gi, 'Zakah'],
    [/\bProphetengefährten\b/gi, 'Sahaba (Gefährten des Propheten)']
  ];

  for (const [pattern, replacement] of postReplacements) {
    if (pattern.test(result)) {
      result = result.replace(pattern, replacement);
    }
  }

  for (const rule of customRules) {
    if (
      rule.arabicPattern &&
      rule.germanReplacement &&
      arabicSource.includes(rule.arabicPattern) &&
      !result.toLowerCase().includes(rule.germanReplacement.toLowerCase())
    ) {
      if (rule.arabicPattern === 'التقوى' && /Frömmigkeit/i.test(result)) {
        result = result.replace(/Frömmigkeit/gi, rule.germanReplacement);
      }
    }
  }

  return result;
}
