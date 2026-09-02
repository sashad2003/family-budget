/**
 * Автооплата регулярных платежей.
 *
 * Счёт с постоянной суммой можно отметить как автоматический: тогда расход
 * записывается сам, без нажатия. Сервера у приложения нет, поэтому «само»
 * означает — при открытии приложения. Зашли с телефона первого числа или
 * пятнадцатого, зашли через три месяца — недостающие платежи дописываются
 * в тот момент, когда приложение открыли.
 *
 * Отсюда два свойства, которые надо держать в голове.
 *
 * Во-первых, платёж появляется задним числом, а не в срок. Дата у него та,
 * когда он был должен пройти, поэтому в отчётах он лежит правильно, но
 * узнают о нём при следующем открытии.
 *
 * Во-вторых, приложение открыто у нескольких человек сразу, и проверку
 * делают все. От повторов защищает имя документа: оно собрано из счёта и
 * месяца, поэтому вторая запись ложится поверх первой (см.
 * createAutoBillPayment). От воскрешения отменённой оплаты защищает отметка
 * autoPaidThrough у счёта: месяц считается отработанным, даже если запись
 * потом удалили руками.
 */

import { monthOf, shiftMonth } from '../core/dates.js?v=106';
import { createAutoBillPayment } from './transactions.js?v=106';
import { markAutoPaid } from './bills.js?v=106';

/**
 * Насколько глубоко догоняем пропущенное.
 *
 * Счёт мог простоять с автооплатой год, пока им не пользовались. Дописать
 * разом двенадцать платежей — уже сомнительно, а сорок восемь означало бы
 * переписать человеку всю историю бюджета. Предел ограничивает ущерб от
 * такой встречи, а не описывает нормальную работу: при обычном пользовании
 * догонять приходится один месяц, редко два.
 */
const MAX_CATCH_UP_MONTHS = 12;

/**
 * С какого месяца автооплата начинает работать, когда её только включили.
 *
 * Ставится предыдущий месяц, то есть счёт начинает платиться с текущего и
 * дальше. Без этого включение галочки разом дописало бы платежи за все
 * месяцы с начала слежения — человек просил избавить его от ежемесячного
 * нажатия, а не выставить счёт за прошлое.
 *
 * Назад отметка не отодвигается: у счёта, который уже платился сам,
 * перещёлкивание галочки не должно заставлять его платить заново.
 */
export function autoStartMark(bill, todayIso = new Date().toISOString().slice(0, 10)) {
  const previous = shiftMonth(monthOf(todayIso), -1);
  return bill.autoPaidThrough && bill.autoPaidThrough > previous
    ? bill.autoPaidThrough
    : previous;
}

/**
 * Месяцы, за которые счёт нужно оплатить прямо сейчас.
 *
 * Чистая функция — ей нужны только данные, поэтому её поведение можно
 * проверить, ничего никуда не записывая.
 */
export function pendingMonths(bill, state, todayIso) {
  if (!bill.auto || !bill.fixed || bill.active === false) return [];
  if (!(Number(bill.amount) > 0)) return [];

  const nowMonth = monthOf(todayIso);

  /**
   * Раньше начала слежения не платим, раньше отработанного месяца — тоже.
   * Отметка сдвигает начало на месяц вперёд: сам он уже закрыт.
   */
  let from = bill.startMonth || nowMonth;
  if (bill.autoPaidThrough && bill.autoPaidThrough >= from) {
    from = shiftMonth(bill.autoPaidThrough, 1);
  }

  const earliest = shiftMonth(nowMonth, -(MAX_CATCH_UP_MONTHS - 1));
  if (from < earliest) from = earliest;

  const paidMonths = new Set(
    state.transactions.filter((tx) => tx.billId === bill.id).map((tx) => monthOf(tx.date)),
  );

  const months = [];
  for (let month = from; month <= nowMonth; month = shiftMonth(month, 1)) {
    // Текущий месяц ждёт своего числа: платёж с датой в будущем — выдумка.
    if (month === nowMonth && !dueDayReached(bill, todayIso)) continue;
    if (paidMonths.has(month)) continue;
    months.push(month);
  }

  return months;
}

/**
 * Наступил ли день оплаты. День не указан — считаем с первого числа.
 *
 * День сверяем с длиной месяца: 31-е число в сентябре не наступает никогда,
 * и без этой поправки такой счёт ждал бы до октября.
 */
function dueDayReached(bill, todayIso) {
  const [year, month] = todayIso.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return Number(todayIso.slice(8, 10)) >= Math.min(Number(bill.dueDay) || 1, lastDay);
}

/** Дата платежа: назначенное число месяца, но не позже последнего дня. */
function paymentDate(bill, month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const day = Math.min(Number(bill.dueDay) || 1, lastDay);
  return `${month}-${String(day).padStart(2, '0')}`;
}

/**
 * Записывает всё, что назрело, и возвращает список записанного.
 *
 * Ошибка по одному счёту не должна мешать остальным: связь могла пропасть
 * посреди списка, и лучше записать три платежа из пяти, чем ни одного.
 * Недостающие допишутся при следующем открытии — для того и отметка.
 */
export async function runAutoBills(state, todayIso = new Date().toISOString().slice(0, 10)) {
  if (!state.user || !state.bills?.length) return [];

  const done = [];

  for (const bill of state.bills) {
    const months = pendingMonths(bill, state, todayIso);
    if (!months.length) continue;

    try {
      for (const month of months) {
        await createAutoBillPayment({
          type: 'expense',
          amount: Number(bill.amount),
          currency: bill.currency,
          categoryId: bill.categoryId,
          date: paymentDate(bill, month),
          note: bill.name,
          source: 'bill',
          billId: bill.id,
        }, { rates: state.rates, user: state.user });

        done.push({ bill, month });
      }

      // Отметку двигаем после записей: упав на середине, в следующий раз
      // начнём с того же места и допишем остаток.
      await markAutoPaid(bill.id, months[months.length - 1]);
    } catch (error) {
      console.error(`Автооплата «${bill.name}» не прошла`, error);
    }
  }

  return done;
}
