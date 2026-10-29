import {
  DEFAULT_WORK_LANGUAGES,
  detectRequiredLanguages,
  detectTextLanguages,
  detectVacancyLanguages,
  languageLabel,
  matchesWorkLanguages,
  NO_LANGUAGES,
  vacancyLanguageList,
} from './work-language';

const SPANISH =
  'Buscamos un desarrollador frontend con experiencia en React y TypeScript para unirse a nuestro equipo. ' +
  'Ofrecemos trabajo remoto y un buen ambiente. Requisitos: 5 años de experiencia con React.';
const RUSSIAN =
  'Ищем frontend-разработчика в команду. Требования: опыт работы с React от 3 лет, TypeScript. ' +
  'Условия: удалённо, белая зарплата.';
const UKRAINIAN =
  'Шукаємо frontend розробника у команду. Вимоги: досвід роботи з React від 3 років, знання TypeScript. ' +
  'Що пропонуємо: віддалена робота.';
const ENGLISH =
  'We are looking for a Senior Frontend Developer to join our team. You will work with React and TypeScript ' +
  'and have a say in the architecture of the product.';

describe('detectTextLanguages', () => {
  it.each([
    ['es', 'Desarrollador Frontend Senior', SPANISH],
    ['ru', 'Frontend-разработчик (React)', RUSSIAN],
    ['uk', 'Frontend розробник', UKRAINIAN],
    ['en', 'Senior Frontend Developer', ENGLISH],
    [
      'de',
      'Frontend Entwickler (m/w/d)',
      'Wir suchen einen Frontend Entwickler für unser Team in Berlin. Du hast Erfahrung mit React und TypeScript.',
    ],
    [
      'fr',
      'Développeur Frontend (H/F)',
      'Nous recherchons un développeur pour notre équipe. Vous avez une expérience avec React et TypeScript.',
    ],
    [
      'pl',
      'Programista Frontend',
      'Szukamy programisty do naszego zespołu. Oferujemy pracę zdalną oraz elastyczne godziny, doświadczenie z React jest wymagane.',
    ],
  ])('reads %s', (code, title, description) => {
    expect(detectTextLanguages(title, description)[0]).toBe(code);
  });

  it('tells Russian from Ukrainian although both are Cyrillic', () => {
    expect(detectTextLanguages('', RUSSIAN)).toEqual(['ru']);
    expect(detectTextLanguages('', UKRAINIAN)).toEqual(['uk']);
  });

  it('keeps both halves of a bilingual posting, the larger first', () => {
    expect(detectTextLanguages('Frontend Developer', `${RUSSIAN}\n\n${ENGLISH}`).sort()).toEqual(['en', 'ru']);
    expect(detectTextLanguages('Frontend Developer', `${RUSSIAN} ${RUSSIAN}\n\n${ENGLISH}`)).toEqual(['ru', 'en']);
  });

  it('does not read technology names as English', () => {
    expect(detectTextLanguages('React developer', 'React, TypeScript, Next.js, Redux, GraphQL, Jest')).toEqual([]);
  });

  it('takes a non-English job title alone as enough, an English one as nothing', () => {
    expect(detectTextLanguages('Desarrollador Frontend React', '')).toEqual(['es']);
    expect(detectTextLanguages('Senior Frontend Developer', '')).toEqual([]);
  });
});

describe('detectRequiredLanguages', () => {
  it.each([
    ['Fluent German is required.', ['de']],
    ['Inglés avanzado (C1) imprescindible.', ['en']],
    ['Английский язык на уровне B2.', ['en']],
    ['Знание польского языка обязательно.', ['pl']],
    ['English: Upper-Intermediate', ['en']],
    ['Sehr gute Deutschkenntnisse und gute Englischkenntnisse.', ['en', 'de']],
    ['Trainee Low-code Developer (French-speaking)', ['fr']],
    ['Русскоязычная команда.', ['ru']],
    ['Excellent written and spoken English and Spanish.', ['en', 'es']],
  ])('finds the requirement in %j', (text, expected) => {
    expect(detectRequiredLanguages(text)).toEqual(expected);
  });

  it.each([
    'French is a nice to have.',
    'Fluent English, German is a plus.',
    'Немецкий будет плюсом.',
    'Join a French company building developer tools.',
    'English version below.',
    'Office in Deutschland, near the station.',
  ])('reads no requirement into %j', (text) => {
    expect(detectRequiredLanguages(text).filter((code) => code !== 'en')).toEqual([]);
  });

  it('ignores a "nice to have" English as well', () => {
    expect(detectRequiredLanguages('Английский — будет плюсом.')).toEqual([]);
  });
});

describe('detectVacancyLanguages', () => {
  it('reads the text and the requirements together', () => {
    expect(
      detectVacancyLanguages({ title: 'Senior Frontend Developer', description: `${ENGLISH} Fluent German is required.` }),
    ).toEqual({ text: ['en'], required: ['de'] });
  });

  it('reads only the title when asked to (a LinkedIn alert summary)', () => {
    const vacancy = {
      title: 'Desarrollador Frontend',
      description: 'Desarrollador Frontend at Acme.\nFrom a LinkedIn job-alert email; the full posting is on LinkedIn.',
    };
    expect(detectVacancyLanguages(vacancy, true)).toEqual({ text: ['es'], required: [] });
  });
});

describe('matchesWorkLanguages', () => {
  const mine = ['en', 'ru'];

  it('lets anything through when the user picked no language', () => {
    expect(matchesWorkLanguages([], { text: ['es'], required: ['de'] })).toBe(true);
  });

  it('drops a posting written in another language', () => {
    expect(matchesWorkLanguages(mine, { text: ['es'], required: [] })).toBe(false);
    expect(matchesWorkLanguages(mine, { text: ['es'], required: ['en'] })).toBe(false);
  });

  it('keeps a bilingual posting when one of its languages is the user’s', () => {
    expect(matchesWorkLanguages(mine, { text: ['es', 'en'], required: [] })).toBe(true);
  });

  it('drops a posting that requires a language the user does not have', () => {
    expect(matchesWorkLanguages(mine, { text: ['en'], required: ['de'] })).toBe(false);
    expect(matchesWorkLanguages(mine, { text: ['ru'], required: ['en'] })).toBe(true);
  });

  it('keeps a posting whose language could not be told', () => {
    expect(matchesWorkLanguages(mine, NO_LANGUAGES)).toBe(true);
  });
});

describe('labels and defaults', () => {
  it('lists the written languages first, without repeats', () => {
    expect(vacancyLanguageList({ text: ['es'], required: ['en', 'es'] })).toEqual(['es', 'en']);
  });

  it('names languages in the account language', () => {
    expect(languageLabel('es', 'ru')).toBe('Испанский');
    expect(languageLabel('es', 'en')).toBe('Spanish');
  });

  it('starts new users on English, Russian and Ukrainian', () => {
    expect(DEFAULT_WORK_LANGUAGES).toEqual(['en', 'ru', 'uk']);
  });
});
