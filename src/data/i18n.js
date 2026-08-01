/**
 * Словарь приложения: ключ и три перевода рядом.
 *
 * Порядок ключей — по экранам, как они встречаются человеку. Русский здесь
 * первоисточник: приложение писалось на нём, остальные переводились с него.
 */

export const DICT = {
  // ---------------------------------------------------------------- общее
  'app.name': { ru: 'Бюджет', en: 'Budget', he: 'תקציב' },
  'app.title': { ru: 'Семейный бюджет', en: 'Family budget', he: 'תקציב משפחתי' },

  'common.cancel': { ru: 'Отмена', en: 'Cancel', he: 'ביטול' },
  'common.close': { ru: 'Закрыть', en: 'Close', he: 'סגירה' },
  'common.save': { ru: 'Сохранить', en: 'Save', he: 'שמירה' },
  'common.delete': { ru: 'Удалить', en: 'Delete', he: 'מחיקה' },
  'common.add': { ru: 'Добавить', en: 'Add', he: 'הוספה' },
  'common.refresh': { ru: 'Обновить', en: 'Refresh', he: 'רענון' },
  'common.copy': { ru: 'Скопировать', en: 'Copy', he: 'העתקה' },
  'common.all': { ru: 'все', en: 'all', he: 'הכול' },
  'common.you': { ru: 'вы', en: 'you', he: 'אתם' },
  'common.notFound': { ru: 'Ничего не найдено', en: 'Nothing found', he: 'לא נמצא דבר' },

  // ---------------------------------------------------------------- вход
  'auth.tagline': {
    ru: 'Расходы семьи в динарах, евро и шекелях — в одном месте',
    en: 'Family spending in dinars, euros and shekels — all in one place',
    he: 'הוצאות המשפחה בדינרים, אירו ושקלים — במקום אחד',
  },
  'auth.signin': { ru: 'Войти через Google', en: 'Sign in with Google', he: 'כניסה עם Google' },
  'auth.failed': {
    ru: 'Не удалось войти. Проверьте, что домен разрешён в Firebase Auth.',
    en: 'Sign-in failed. Check that the domain is allowed in Firebase Auth.',
    he: 'הכניסה נכשלה. ודאו שהדומיין מאושר ב-Firebase Auth.',
  },
  'auth.loadFailed': {
    ru: 'Не удалось загрузить данные',
    en: 'Could not load your data',
    he: 'לא הצלחנו לטעון את הנתונים',
  },

  // ---------------------------------------------------------------- анкета
  'signup.title': { ru: 'Ещё пара слов', en: 'A couple more things', he: 'עוד שני פרטים' },
  'signup.sub': {
    ru: 'Заводим ваш бюджет. Пригласить мужа или жену можно сразу после.',
    en: 'Setting up your budget. You can invite your partner right after.',
    he: 'פותחים לכם תקציב. אפשר להזמין בן או בת זוג מיד לאחר מכן.',
  },
  'signup.name': { ru: 'Как вас зовут', en: 'Your name', he: 'איך קוראים לכם' },
  'signup.namePlaceholder': { ru: 'Имя и фамилия', en: 'First and last name', he: 'שם פרטי ומשפחה' },
  'signup.phone': { ru: 'Телефон', en: 'Phone', he: 'טלפון' },
  'signup.marketing': {
    ru: 'Присылайте мне письма о новых возможностях приложения',
    en: 'Email me about new features',
    he: 'שלחו לי עדכונים על יכולות חדשות',
  },
  'signup.privacy': {
    ru: 'Имя, почту и телефон храним, чтобы вести ваш аккаунт и отвечать на вопросы. Никому не передаём. Удалить их можно в настройках.',
    en: 'We keep your name, email and phone to run your account and answer questions. We never pass them on. You can delete them in settings.',
    he: 'אנו שומרים שם, דוא״ל וטלפון כדי לנהל את החשבון ולענות לשאלות. איננו מעבירים אותם לאיש. אפשר למחוק אותם בהגדרות.',
  },
  'signup.submit': { ru: 'Продолжить', en: 'Continue', he: 'המשך' },
  'signup.creating': { ru: 'Создаём…', en: 'Creating…', he: 'יוצרים…' },
  'signup.signOut': { ru: 'Выйти из {email}', en: 'Sign out of {email}', he: 'התנתקות מ-{email}' },
  'signup.nameRequired': { ru: 'Напишите имя', en: 'Enter your name', he: 'הזינו שם' },
  'signup.phoneRequired': { ru: 'Проверьте номер телефона', en: 'Check the phone number', he: 'בדקו את מספר הטלפון' },
  'signup.failed': {
    ru: 'Не удалось завершить регистрацию',
    en: 'Could not finish signing up',
    he: 'לא הצלחנו להשלים את ההרשמה',
  },

  // ---------------------------------------------------------------- разделы
  'nav.dashboard': { ru: 'Обзор', en: 'Overview', he: 'סקירה' },
  'nav.list': { ru: 'Операции', en: 'Transactions', he: 'תנועות' },
  'nav.bills': { ru: 'Платежи', en: 'Bills', he: 'תשלומים' },
  'nav.prices': { ru: 'Цены', en: 'Prices', he: 'מחירים' },
  'nav.charts': { ru: 'Статистика', en: 'Stats', he: 'סטטיסטיקה' },
  'nav.settings': { ru: 'Настройки', en: 'Settings', he: 'הגדרות' },
  'nav.admin': { ru: 'Люди', en: 'People', he: 'אנשים' },
  'nav.more': { ru: 'Ещё', en: 'More', he: 'עוד' },
  'nav.addTx': { ru: 'Операция', en: 'Transaction', he: 'תנועה' },
  'nav.addTxLabel': { ru: 'Добавить операцию', en: 'Add transaction', he: 'הוספת תנועה' },
  'nav.prevMonth': { ru: 'Предыдущий месяц', en: 'Previous month', he: 'חודש קודם' },
  'nav.nextMonth': { ru: 'Следующий месяц', en: 'Next month', he: 'חודש הבא' },
  'nav.baseCurrency': { ru: 'Валюта сводных сумм', en: 'Currency for totals', he: 'מטבע הסיכומים' },

  'more.list': {
    ru: 'Полный список за месяц с поиском и фильтрами',
    en: 'Full month list with search and filters',
    he: 'רשימת החודש המלאה עם חיפוש וסינון',
  },
  'more.prices': {
    ru: 'Где товар дешевле — по чекам всех пользователей',
    en: 'Where an item is cheaper — from everyone’s receipts',
    he: 'איפה המוצר זול יותר — לפי קבלות של כל המשתמשים',
  },
  'more.charts': {
    ru: 'Траты по категориям и динамика за период',
    en: 'Spending by category and trends over time',
    he: 'הוצאות לפי קטגוריה ומגמות לאורך זמן',
  },
  'more.settings': {
    ru: 'Категории, валюта, профиль',
    en: 'Categories, currency, profile',
    he: 'קטגוריות, מטבע, פרופיל',
  },
  'more.admin': {
    ru: 'Кто зарегистрировался в приложении',
    en: 'Who has signed up',
    he: 'מי נרשם לאפליקציה',
  },

  // ---------------------------------------------------------------- бюджеты
  'budget.title': { ru: 'Бюджеты', en: 'Budgets', he: 'תקציבים' },
  'budget.one': { ru: 'Бюджет', en: 'Budget', he: 'תקציב' },
  'budget.open': { ru: 'открыт', en: 'open', he: 'פתוח' },
  'budget.ofName': { ru: 'Бюджет {name}', en: '{name}’s budget', he: 'התקציב של {name}' },
  'budget.hint': {
    ru: 'Чужой бюджет появляется здесь после перехода по ссылке-приглашению.',
    en: 'Someone else’s budget shows up here once you follow their invite link.',
    he: 'תקציב של מישהו אחר יופיע כאן אחרי מעבר בקישור ההזמנה.',
  },
  'budget.switchFailed': {
    ru: 'Не удалось переключить бюджет',
    en: 'Could not switch budget',
    he: 'לא הצלחנו להחליף תקציב',
  },
  'budget.openFailed': { ru: 'Не удалось открыть бюджет', en: 'Could not open budget', he: 'לא הצלחנו לפתוח תקציב' },
  'budget.rememberFailed': {
    ru: 'Бюджет открыт, но запомнить выбор не вышло',
    en: 'Budget opened, but we could not remember the choice',
    he: 'התקציב נפתח, אך לא הצלחנו לזכור את הבחירה',
  },
  'budget.members': { ru: '{n} участн.', en: '{n} members', he: '{n} משתתפים' },

  // ---------------------------------------------------------------- настройки
  'settings.noName': { ru: 'Без имени', en: 'No name', he: 'ללא שם' },
  'settings.signOut': { ru: 'Выйти', en: 'Sign out', he: 'התנתקות' },
  'settings.language': { ru: 'Язык', en: 'Language', he: 'שפה' },
  'settings.baseCurrency': { ru: 'Валюта сводных сумм', en: 'Currency for totals', he: 'מטבע הסיכומים' },
  'settings.baseCurrencyHint': {
    ru: 'Операции хранятся в своей валюте. Итоги и графики показываются в выбранной здесь — по курсу, зафиксированному в момент добавления каждой операции.',
    en: 'Transactions keep their own currency. Totals and charts use the one chosen here, at the rate recorded when each transaction was added.',
    he: 'התנועות נשמרות במטבע שלהן. הסיכומים והגרפים מוצגים במטבע שנבחר כאן, לפי השער שנרשם בעת הוספת כל תנועה.',
  },
  'settings.rates': { ru: 'Курсы валют', en: 'Exchange rates', he: 'שערי מטבע' },
  'settings.ratesUpdated': { ru: 'Обновлено: {when}', en: 'Updated: {when}', he: 'עודכן: {when}' },
  'settings.ratesFallback': {
    ru: 'Используются запасные курсы — источник недоступен',
    en: 'Using fallback rates — the source is unavailable',
    he: 'בשימוש שערי גיבוי — המקור אינו זמין',
  },
  'settings.ratesOk': { ru: 'Курсы обновлены', en: 'Rates updated', he: 'השערים עודכנו' },
  'settings.ratesFailed': { ru: 'Не удалось обновить курсы', en: 'Could not update rates', he: 'לא הצלחנו לעדכן שערים' },

  'family.title': { ru: 'Семья · {n}', en: 'Family · {n}', he: 'משפחה · {n}' },
  'family.owner': { ru: 'хозяин', en: 'owner', he: 'בעלים' },
  'family.invite': { ru: 'пригласить', en: 'invite', he: 'הזמנה' },
  'family.remove': { ru: 'убрать', en: 'remove', he: 'הסרה' },
  'family.leave': { ru: 'выйти', en: 'leave', he: 'יציאה' },
  'family.ownerHint': {
    ru: 'Пошлите ссылку-приглашение мужу, жене или кому угодно: кто по ней войдёт, окажется в этом бюджете. Убрать участника может только хозяин бюджета.',
    en: 'Send the invite link to your partner or anyone else: whoever follows it joins this budget. Only the owner can remove members.',
    he: 'שלחו את קישור ההזמנה לבן או בת הזוג או לכל אדם אחר: מי שייכנס דרכו יצטרף לתקציב הזה. רק הבעלים יכול להסיר משתתפים.',
  },
  'family.guestHint': {
    ru: 'Бюджет ведёт {name}. Состав участников меняет он — вы можете только выйти сами.',
    en: '{name} runs this budget and manages who is in it. You can only leave it yourself.',
    he: '{name} מנהל את התקציב ואת רשימת המשתתפים. אתם יכולים רק לצאת בעצמכם.',
  },
  'family.removeTitle': { ru: 'Убрать из бюджета?', en: 'Remove from budget?', he: 'להסיר מהתקציב?' },
  'family.removeText': {
    ru: '{name} потеряет доступ. Записи останутся на месте.',
    en: '{name} will lose access. Their entries stay.',
    he: '{name} יאבד גישה. הרשומות יישארו במקומן.',
  },
  'family.removed': { ru: 'Убрали', en: 'Removed', he: 'הוסר' },
  'family.removeFailed': { ru: 'Не удалось убрать', en: 'Could not remove', he: 'ההסרה נכשלה' },
  'family.leaveTitle': { ru: 'Выйти из бюджета?', en: 'Leave this budget?', he: 'לצאת מהתקציב?' },
  'family.leaveText': {
    ru: 'Вы перестанете его видеть. Записи, которые вы вносили, останутся у семьи.',
    en: 'You will stop seeing it. The entries you added stay with the family.',
    he: 'לא תראו אותו יותר. הרשומות שהוספתם יישארו אצל המשפחה.',
  },
  'family.left': { ru: 'Вышли из бюджета', en: 'You left the budget', he: 'יצאתם מהתקציב' },
  'family.leaveFailed': { ru: 'Не удалось выйти', en: 'Could not leave', he: 'היציאה נכשלה' },
  'family.lastBudget': {
    ru: 'Это ваш единственный бюджет — выйти из него нельзя',
    en: 'This is your only budget — you cannot leave it',
    he: 'זהו התקציב היחיד שלכם — אי אפשר לצאת ממנו',
  },

  'invite.title': { ru: 'Пригласить в бюджет', en: 'Invite to budget', he: 'הזמנה לתקציב' },
  'invite.link': { ru: 'Ссылка-приглашение', en: 'Invite link', he: 'קישור הזמנה' },
  'invite.preparing': { ru: 'Готовим ссылку…', en: 'Preparing the link…', he: 'מכינים קישור…' },
  'invite.hint': {
    ru: 'Пошлите её в любом мессенджере. Человек откроет ссылку, войдёт через Google и попадёт в этот бюджет. Ссылка постоянная — кто её получит, тот и войдёт.',
    en: 'Send it in any messenger. They open the link, sign in with Google and land in this budget. The link is permanent — whoever gets it can join.',
    he: 'שלחו אותו בכל אפליקציית הודעות. הנמען יפתח את הקישור, ייכנס עם Google ויגיע לתקציב הזה. הקישור קבוע — כל מי שיקבל אותו יוכל להצטרף.',
  },
  'invite.reset': { ru: 'Сделать новую ссылку', en: 'Create a new link', he: 'יצירת קישור חדש' },
  'invite.resetDone': {
    ru: 'Старая ссылка больше не работает',
    en: 'The old link no longer works',
    he: 'הקישור הישן אינו פעיל יותר',
  },
  'invite.resetFailed': { ru: 'Не удалось обновить ссылку', en: 'Could not refresh the link', he: 'לא הצלחנו לרענן את הקישור' },
  'invite.copied': { ru: 'Ссылка скопирована', en: 'Link copied', he: 'הקישור הועתק' },
  'invite.copyManually': { ru: 'Скопируйте ссылку вручную', en: 'Copy the link manually', he: 'העתיקו את הקישור ידנית' },
  'invite.createFailed': { ru: 'Не удалось создать ссылку', en: 'Could not create the link', he: 'לא הצלחנו ליצור קישור' },
  'invite.joined': { ru: 'Вы в общем бюджете', en: 'You are in the shared budget', he: 'הצטרפתם לתקציב המשותף' },
  'invite.failed': {
    ru: 'Ссылка-приглашение не сработала',
    en: 'The invite link did not work',
    he: 'קישור ההזמנה לא עבד',
  },
  'invite.expired': {
    ru: 'Ссылка-приглашение больше не действует',
    en: 'This invite link is no longer valid',
    he: 'קישור ההזמנה כבר אינו בתוקף',
  },

  'settings.categories': { ru: 'Категории', en: 'Categories', he: 'קטגוריות' },
  'settings.expenses': { ru: 'Расходы', en: 'Expenses', he: 'הוצאות' },
  'settings.incomes': { ru: 'Доходы', en: 'Income', he: 'הכנסות' },
  'settings.footer': {
    ru: 'Семейный бюджет · данные в Firestore, распознавание чеков через Claude',
    en: 'Family budget · data in Firestore, receipts read by Claude',
    he: 'תקציב משפחתי · נתונים ב-Firestore, קריאת קבלות באמצעות Claude',
  },

  // ---------------------------------------------------------------- поддержка и документы
  'legal.title': { ru: 'Документы и поддержка', en: 'Documents and support', he: 'מסמכים ותמיכה' },
  'legal.privacy': { ru: 'Политика конфиденциальности', en: 'Privacy Policy', he: 'מדיניות פרטיות' },
  'legal.terms': { ru: 'Условия использования', en: 'Terms of Service', he: 'תנאי שימוש' },
  'legal.accessibility': { ru: 'Доступность', en: 'Accessibility', he: 'נגישות' },
  'legal.cookies': { ru: 'Файлы cookie', en: 'Cookie Policy', he: 'מדיניות עוגיות' },
  'support.whatsapp': { ru: 'Написать в WhatsApp', en: 'Message on WhatsApp', he: 'כתבו לנו בוואטסאפ' },
  'support.hint': {
    ru: 'Вопрос, поломка или пожелание — пишите, отвечаю сам.',
    en: 'A question, a bug or an idea — write to me, I answer personally.',
    he: 'שאלה, תקלה או רעיון — כתבו לי, אני עונה אישית.',
  },

  // ---------------------------------------------------------------- обзор и список
  'dash.recent': { ru: 'Последние операции', en: 'Recent transactions', he: 'תנועות אחרונות' },
  'dash.where': { ru: 'Куда уходят деньги', en: 'Where the money goes', he: 'לאן הכסף הולך' },
  'list.searchPlaceholder': {
    ru: 'Поиск по описанию, магазину, товарам',
    en: 'Search by note, shop or item',
    he: 'חיפוש לפי הערה, חנות או מוצר',
  },
  'list.typeAll': { ru: 'Все', en: 'All', he: 'הכול' },
  'list.typeExpense': { ru: 'Расходы', en: 'Expenses', he: 'הוצאות' },
  'list.typeIncome': { ru: 'Доходы', en: 'Income', he: 'הכנסות' },
  'list.count': { ru: '{n} операц.', en: '{n} transactions', he: '{n} תנועות' },
  'tx.operation': { ru: 'Операция', en: 'Transaction', he: 'תנועה' },
  'tx.noCategory': { ru: 'Без категории', en: 'No category', he: 'ללא קטגוריה' },
  'tx.items': { ru: '{n} поз.', en: '{n} items', he: '{n} פריטים' },
  'tx.fromSms': { ru: 'SMS', en: 'SMS', he: 'SMS' },
  'tx.fromReceipt': { ru: 'чек', en: 'receipt', he: 'קבלה' },

  // ---------------------------------------------------------------- ошибки данных
  'error.categories': { ru: 'Нет доступа к категориям', en: 'No access to categories', he: 'אין גישה לקטגוריות' },
  'error.transactions': { ru: 'Нет доступа к операциям', en: 'No access to transactions', he: 'אין גישה לתנועות' },
  'error.bills': { ru: 'Нет доступа к платежам', en: 'No access to bills', he: 'אין גישה לתשלומים' },
  'error.rates': {
    ru: 'Курсы валют не обновились, используются сохранённые',
    en: 'Exchange rates did not refresh, using the saved ones',
    he: 'שערי המטבע לא התעדכנו, נעשה שימוש בשמורים',
  },
};
