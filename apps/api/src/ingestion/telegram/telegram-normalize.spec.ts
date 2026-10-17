import {
  extractCompany,
  extractEmploymentType,
  extractSalary,
  extractTitle,
  extractWorkFormat,
  hasVacancySignals,
  isJunkPost,
  isLikelyVacancy,
  isPromoPost,
  isResumePost,
  normalizeTelegramMessage,
} from "./telegram-normalize";

const SOURCE_ID = "00000000-0000-0000-0000-000000000001";

const RU_POST = `🔥 **Senior Frontend Developer (React)**

Компания: Яндекс
Локация: Москва / удалёнка
Вилка: от 3000 до 5000 $ на руки
Полная занятость.

Ищем сильного фронтендера в команду поиска.
Стек: React, TypeScript, Node.js.
Писать: @recruiter`;

const EN_POST = `Backend Engineer (Go) — remote

Company: Acme Inc
Salary: $4k-6k
Part-time OK.

We are a small fintech startup building payment rails.
Apply: jobs@acme.dev`;

describe("telegram-normalize", () => {
  it("filters out short service posts", () => {
    expect(isLikelyVacancy("Канал вернулся из отпуска!")).toBe(false);
    expect(isLikelyVacancy(RU_POST)).toBe(true);
  });

  it("rejects moderation-bot notices, giveaways and ads even when long enough", () => {
    const banNotice =
      "⛔ vlad pushkov, тебя заблокировали (Lols Ban)\n\n" +
      "Пользователь отмечен к глобальной блокировке в боте (Lols ban) — " +
      "подробнее о том, что делать в таком случае, можно почитать по ссылке.";
    expect(isJunkPost(banNotice)).toBe(true);
    expect(isLikelyVacancy(banNotice)).toBe(false);

    expect(
      isJunkPost(
        "Розыгрыш MacBook среди подписчиков! Условия участия внутри поста.",
      ),
    ).toBe(true);
    expect(
      isJunkPost(
        "Реклама: наш партнёрский канал с курсами по программированию.",
      ),
    ).toBe(true);

    // A real vacancy that merely mentions "заблокировать доступ" is not junk.
    expect(isJunkPost(RU_POST)).toBe(false);
    expect(isJunkPost(EN_POST)).toBe(false);
  });

  it("rejects job seekers' posts from the vacancy-and-resume group chats", () => {
    const resume =
      "#резюме #frontend\nМиддл фронтенд-разработчик, 4 года опыта.\n" +
      "Стек: React, TypeScript, Next.js. Рассматриваю удалёнку, связь: @me";
    expect(isResumePost(resume)).toBe(true);
    expect(isLikelyVacancy(resume)).toBe(false);
    expect(
      isResumePost(
        "Всем привет! Ищу работу Python-разработчиком, опыт 3 года, Django и FastAPI.",
      ),
    ).toBe(true);
    expect(
      isResumePost("#CV Senior Go developer, 6 years, open to remote roles."),
    ).toBe(true);
    expect(
      isResumePost(
        "Senior QA, looking for a new opportunity, remote only. DM me.",
      ),
    ).toBe(true);

    // Vacancies that say "ищем"/"ищу разработчика" or mention a CV are kept.
    expect(isResumePost(RU_POST)).toBe(false);
    expect(isResumePost(EN_POST)).toBe(false);
    expect(
      isResumePost(
        "#вакансия Ищу React-разработчика в команду, резюме присылайте в личку.",
      ),
    ).toBe(false);
    expect(
      isResumePost(
        "Send your CV to jobs@acme.dev, we are looking for a Go engineer.",
      ),
    ).toBe(false);
  });

  it("rejects career-service ads that read like job-search talk", () => {
    // Reported 2026-10-17: a native ad from a job channel reached the digest.
    const quest =
      "Сейчас найти работу - целый квест. Делаешь тестовое весь день идеально, " +
      "чтобы не получить приглашение на собес - и так по кругу. Поиск может " +
      "длиться месяцами, а деньги заканчиваются уже через пару недель.\n\n" +
      "Подписывайся на канал, там разбираем, как пройти отбор: @career_hub";
    expect(hasVacancySignals(quest)).toBe(false);
    expect(isLikelyVacancy(quest)).toBe(false);

    const offer =
      "Junior и Middle разработчики, хватит отправлять сотни откликов!\n" +
      "Поможем получить оффер за 2 месяца: разбор резюме, мок-собесы, " +
      "автоотклики на удалёнку. Записывайся по ссылке.";
    expect(isPromoPost(offer)).toBe(true);
    expect(isLikelyVacancy(offer)).toBe(false);

    const course =
      "Frontend-разработчик с нуля до первой работы за 9 месяцев.\n" +
      "Онлайн-школа, обучение с трудоустройством, удалённо, оплата частями.";
    expect(isPromoPost(course)).toBe(true);
    expect(isLikelyVacancy(course)).toBe(false);
  });

  it("rejects channel chatter that names no role", () => {
    expect(
      isLikelyVacancy(
        "Друзья, напоминаем правила чата: без оскорблений и флуда. " +
          "Вопросы по размещению пишите админу, отвечаем в течение дня.",
      ),
    ).toBe(false);
    expect(
      isLikelyVacancy(
        "Итоги недели: 120 новых постов, спасибо, что читаете! " +
          "В понедельник расскажем, что изменилось на рынке за месяц.",
      ),
    ).toBe(false);
  });

  it("keeps the vacancy formats the channels actually use", () => {
    expect(isPromoPost(RU_POST)).toBe(false);
    expect(isPromoPost(EN_POST)).toBe(false);
    expect(hasVacancySignals(RU_POST)).toBe(true);
    expect(hasVacancySignals(EN_POST)).toBe(true);

    // Aggregator card: role in the title, tags and a link, no sections.
    expect(
      isLikelyVacancy(
        "React-разработчик в финтех\nКомпания: Тинькофф\n#react #typescript\n" +
          "Подробнее и отклик: https://example.com/jobs/123",
      ),
    ).toBe(true);
    // Freelance order: the role is mid-text, backed by a hiring marker.
    expect(
      isLikelyVacancy(
        "Telegram-бот для записи клиентов\nНужен разработчик на aiogram, " +
          "бюджет 40 000 ₽, срок две недели. Пишите в личку @client",
      ),
    ).toBe(true);
    // English hiring post with the role after a hiring marker.
    expect(
      isLikelyVacancy(
        "We're hiring! Join our team as a Go engineer to build payment rails. " +
          "Remote, EU time zones. Send your CV to jobs@acme.dev",
      ),
    ).toBe(true);
    // Benefits that mention training or discounts are not ads.
    expect(
      isLikelyVacancy(
        "Middle QA Engineer\nУсловия: обучение за счёт компании, скидки на " +
          "продукты, курсы английского. Подписывайтесь на канал, чтобы не пропустить новые вакансии.",
      ),
    ).toBe(true);
  });

  it("extracts the first line as the title, stripping markdown and emoji", () => {
    expect(extractTitle(RU_POST)).toBe("Senior Frontend Developer (React)");
    expect(extractTitle(EN_POST)).toBe("Backend Engineer (Go) — remote");
  });

  it("extracts the company from labeled lines", () => {
    expect(extractCompany(RU_POST)).toBe("Яндекс");
    expect(extractCompany(EN_POST)).toBe("Acme Inc");
    expect(extractCompany("no label here")).toBeNull();
  });

  it("detects work format and employment type from keywords", () => {
    expect(extractWorkFormat(RU_POST)).toBe("remote");
    expect(extractWorkFormat("Работа в офисе, Санкт-Петербург")).toBe("onsite");
    expect(extractWorkFormat("Гибридный формат")).toBe("hybrid");
    expect(extractWorkFormat("nothing relevant")).toBeNull();
    expect(extractEmploymentType(RU_POST)).toBe("full_time");
    expect(extractEmploymentType(EN_POST)).toBe("part_time");
    expect(extractEmploymentType("nothing relevant")).toBeNull();
  });

  it("parses salary ranges with currency markers", () => {
    expect(extractSalary(RU_POST)).toEqual({
      salaryMin: 3000,
      salaryMax: 5000,
      salaryCurrency: "USD",
    });
    expect(extractSalary(EN_POST)).toEqual({
      salaryMin: 4000,
      salaryMax: 6000,
      salaryCurrency: "USD",
    });
    expect(extractSalary("до 300 000 ₽")).toEqual({
      salaryMin: null,
      salaryMax: 300_000,
      salaryCurrency: "RUB",
    });
    expect(extractSalary("от 2500 eur")).toEqual({
      salaryMin: 2500,
      salaryMax: null,
      salaryCurrency: "EUR",
    });
  });

  it("ignores bare number ranges without a currency (dates, ids)", () => {
    expect(extractSalary("Работаем 10-19 по Москве, опыт 3-5 лет")).toEqual({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
    });
  });

  it("normalizes a full message with t.me deep link and channel-scoped external id", () => {
    const row = normalizeTelegramMessage(
      {
        channel: "it_jobs",
        messageId: 421,
        text: RU_POST,
        date: new Date("2026-07-19T10:00:00Z"),
      },
      SOURCE_ID,
    );
    expect(row).toMatchObject({
      sourceId: SOURCE_ID,
      externalId: "it_jobs:421",
      url: "https://t.me/it_jobs/421",
      title: "Senior Frontend Developer (React)",
      companyRaw: "Яндекс",
      workFormat: "remote",
      employmentType: "full_time",
      salaryMin: 3000,
      salaryMax: 5000,
      salaryCurrency: "USD",
      location: "Москва / удалёнка",
    });
    expect(row?.publishedAt).toEqual(new Date("2026-07-19T10:00:00Z"));
  });

  it("falls back to the channel handle when no company is labeled", () => {
    const row = normalizeTelegramMessage(
      {
        channel: "go_jobs",
        messageId: 7,
        text: EN_POST.replace(/^Company:.*$\n/m, ""),
        date: null,
      },
      SOURCE_ID,
    );
    expect(row?.companyRaw).toBe("@go_jobs");
  });

  it("returns null for non-vacancy posts", () => {
    expect(
      normalizeTelegramMessage(
        {
          channel: "it_jobs",
          messageId: 1,
          text: "Реклама: подпишись!",
          date: null,
        },
        SOURCE_ID,
      ),
    ).toBeNull();
  });
});
