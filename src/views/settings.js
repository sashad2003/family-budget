/** Настройки: профиль, участники, валюта, курсы, категории. */

import { el, render } from '../core/dom.js?v=55';
import { state, set } from '../core/store.js?v=55';
import { CURRENCY_CODES, CURRENCIES } from '../config.js?v=55';
import { formatAmount, convert } from '../core/money.js?v=55';
import { logout } from '../services/auth.js?v=55';
import {
  inviteLink, resetInviteLink, removeMember, leaveFamily, isOwner,
} from '../services/account.js?v=55';
import { refreshRates } from '../services/rates.js?v=55';
import { saveCategory, deleteCategory } from '../services/transactions.js?v=55';
import { openSheet, closeSheet, confirmSheet } from '../ui/sheet.js?v=55';
import { section } from '../ui/section.js?v=55';
import { t, intlLocale } from '../core/i18n.js?v=55';
import { toastOk, toastError } from '../ui/toast.js?v=55';

const PALETTE = ['#2dd98a', '#ff5b5b', '#5b9fff', '#ffb347', '#ff7eb3', '#3de8d0', '#8a8a94'];

export function renderSettings() {
  const container = el('div');
  const draw = () => render(container, build(draw));
  draw();
  return container;
}

function build(draw) {
  const members = Object.entries(state.family?.members || {});
  const owner = isOwner(state.family, state.user?.uid);

  return [
    // Профиль
    el('div', { class: 'card', style: 'display:flex;align-items:center;gap:12px' }, [
      state.user?.photoURL
        ? el('img', { src: state.user.photoURL, width: 42, height: 42, style: 'border-radius:50%' })
        : el('div', { class: 'tx__ico' }, '👤'),
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', {}, state.profile?.name || state.user?.displayName || t('settings.noName')),
        el('div', { class: 'list-item__sub' }, state.user?.email || ''),
      ]),
      el('button', { class: 'chip', onclick: () => logout() }, t('settings.signOut')),
    ]),

    section(t('settings.baseCurrency'), [
      el('div', { class: 'segmented' }, CURRENCY_CODES.map((code) =>
        el('button', {
          class: state.base === code ? 'is-active' : '',
          onclick: () => { set({ base: code }); draw(); },
        }, code),
      )),
      el('p', { class: 'hint' }, t('settings.baseCurrencyHint')),
    ]),

    section(t('settings.rates'), [
      el('div', { class: 'card' }, [
        ...CURRENCIES.filter((c) => c.code !== state.base).map((c) =>
          el('div', { class: 'legend-row' }, [
            el('span', { class: 'legend-name' }, `1 ${c.code}`),
            el('span', { class: 'legend-val' },
              formatAmount(convert(1, c.code, state.base, state.rates), state.base)),
          ]),
        ),
        el('p', { class: 'hint' }, state.ratesFetchedAt
          ? t('settings.ratesUpdated', {
              when: new Date(state.ratesFetchedAt).toLocaleString(intlLocale()),
            })
          : t('settings.ratesFallback')),
      ]),
    ], el('button', {
      class: 'chip',
      onclick: async (e) => {
        e.target.textContent = '…';
        try {
          const fresh = await refreshRates();
          set({ rates: fresh.rates, ratesFetchedAt: fresh.fetchedAt });
          toastOk(t('settings.ratesOk'));
        } catch {
          toastError(t('settings.ratesFailed'));
        }
        draw();
      },
    }, t('common.refresh'))),

    section(t('family.title', { n: members.length }), [
      ...members.map(([uid, member]) => memberRow(uid, member, owner)),
      el('p', { class: 'hint' }, owner
        ? t('family.ownerHint')
        : t('family.guestHint', { name: ownerName() })),
    ], owner
      ? el('button', { class: 'chip', onclick: () => openInviteSheet() }, `🔗 ${t('family.invite')}`)
      : null),

    section(t('settings.categories'), ['expense', 'income'].map((type) =>
      el('div', {}, [
        el('div', { class: 'tx-group__date' },
          t(type === 'expense' ? 'settings.expenses' : 'settings.incomes')),
        ...state.categories.filter((c) => c.type === type).map((cat) =>
          el('button', {
            class: 'list-item',
            onclick: () => openCategoryEditor(cat, draw),
          }, [
            el('div', { style: 'display:flex;align-items:center;gap:10px;min-width:0' }, [
              el('span', { style: 'font-size:18px' }, cat.icon || '•'),
              el('span', {}, cat.name),
            ]),
            el('span', { class: 'legend-dot', style: `background:${cat.color}` }),
          ]),
        ),
      ]),
    ), el('button', {
      class: 'chip',
      onclick: () => openCategoryEditor(null, draw),
    }, `＋ ${t('common.add')}`)),

    el('p', { class: 'hint', style: 'margin-top:26px;text-align:center' }, t('settings.footer')),
  ];
}

/**
 * Строка участника.
 *
 * Выкинуть другого может только хозяин бюджета. Всем остальным на своей же
 * строке предлагаем выйти — это отказ от доступа, а не власть над людьми.
 */
function memberRow(uid, member, owner) {
  const me = uid === state.user?.uid;
  const isTheOwner = uid === state.family?.ownerUid;

  let action = null;
  if (me && !isTheOwner) {
    action = el('button', { class: 'chip', onclick: () => askLeave() }, t('family.leave'));
  } else if (me) {
    action = el('span', { class: 'chip' }, t('common.you'));
  } else if (owner) {
    action = el('button', { class: 'chip', onclick: () => askRemove(member, uid) }, t('family.remove'));
  }

  return el('div', { class: 'list-item' }, [
    el('div', { style: 'min-width:0' }, [
      el('div', {}, `${member.name || uid}${isTheOwner ? ` · ${t('family.owner')}` : ''}`),
      el('div', { class: 'list-item__sub' }, member.email || ''),
    ]),
    action,
  ]);
}

function ownerName() {
  const owner = state.family?.members?.[state.family?.ownerUid];
  return owner?.name || owner?.email || '—';
}

/** Подтверждение перед тем, как выкинуть человека из бюджета. */
function askRemove(member, uid) {
  confirmSheet({
    title: t('family.removeTitle'),
    text: t('family.removeText', { name: member.name || member.email }),
    confirmLabel: t('family.remove'),
    onConfirm: async () => {
      try {
        await removeMember(state.family.id, uid);
        toastOk(t('family.removed'));
      } catch {
        toastError(t('family.removeFailed'));
      }
    },
  });
}

function askLeave() {
  confirmSheet({
    title: t('family.leaveTitle'),
    text: t('family.leaveText'),
    confirmLabel: t('family.leave'),
    onConfirm: async () => {
      try {
        const next = await leaveFamily(state.user, state.profile, state.family.id);
        // Список бюджетов и открытый бюджет поменялись — начинаем заново.
        set({ families: (state.families || []).filter((f) => f.id !== state.family.id) });
        window.dispatchEvent(new CustomEvent('switch-budget', { detail: next }));
        toastOk(t('family.left'));
      } catch (error) {
        toastError(error.message || t('family.leaveFailed'));
      }
    },
  });
}

function openCategoryEditor(cat, onDone) {
  const model = {
    id: cat?.id || '',
    name: cat?.name || '',
    type: cat?.type || 'expense',
    icon: cat?.icon || '•',
    color: cat?.color || PALETTE[0],
    order: cat?.order ?? 500,
  };

  const body = el('div');
  const draw = () => render(body, [
    el('div', { class: 'segmented', style: 'margin-bottom:14px' }, ['expense', 'income'].map((type) =>
      el('button', {
        class: model.type === type ? 'is-active' : '',
        dataset: { value: type },
        onclick: () => { model.type = type; draw(); },
      }, t(type === 'expense' ? 'form.expense' : 'form.income')),
    )),

    el('div', { class: 'row', style: 'margin-bottom:14px' }, [
      el('div', { style: 'flex:0 0 76px' }, [
        el('label', { class: 'field__label' }, t('cat.icon')),
        el('input', {
          class: 'input',
          style: 'text-align:center;font-size:20px',
          value: model.icon,
          maxlength: 2,
          oninput: (e) => { model.icon = e.target.value; },
        }),
      ]),
      el('div', {}, [
        el('label', { class: 'field__label' }, t('cat.name')),
        el('input', {
          class: 'input',
          value: model.name,
          placeholder: t('cat.namePlaceholder'),
          oninput: (e) => { model.name = e.target.value; },
        }),
      ]),
    ]),

    el('label', { class: 'field__label' }, t('cat.color')),
    el('div', { class: 'chip-row' }, PALETTE.map((color) =>
      el('button', {
        class: 'chip',
        style: `background:${color}22;border-color:${model.color === color ? color : 'transparent'}`,
        onclick: () => { model.color = color; draw(); },
      }, el('span', { class: 'legend-dot', style: `background:${color}` })),
    )),
  ]);
  draw();

  const footer = [
    cat
      ? el('button', {
          class: 'btn btn--danger',
          onclick: () => {
            closeSheet();
            confirmSheet({
              title: t('cat.deleteTitle'),
              text: t('cat.deleteText'),
              onConfirm: async () => {
                await deleteCategory(cat.id);
                toastOk(t('cat.deleted'));
                onDone();
              },
            });
          },
        }, t('common.delete'))
      : null,

    el('button', {
      class: 'btn btn--primary',
      onclick: async () => {
        const name = model.name.trim();
        if (!name) { toastError(t('cat.nameRequired')); return; }

        const id = model.id || slug(name);
        const { id: _skip, ...data } = model;
        try {
          await saveCategory(id, { ...data, name });
          closeSheet();
          toastOk(t('bills.saved'));
          onDone();
        } catch {
          toastError(t('bills.saveFailed'));
        }
      },
    }, t('common.save')),
  ].filter(Boolean);

  openSheet({ title: t(cat ? 'cat.title' : 'cat.new'), body, footer });
}

/** Транслитерация в id документа: 'Кафе у дома' → 'kafe-u-doma-482'. */
function slug(name) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e',
    ю: 'yu', я: 'ya', ь: '', ъ: '',
  };
  const base = name.toLowerCase().split('').map((ch) => map[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);
  return `${base || 'cat'}-${Math.floor(Math.random() * 900 + 100)}`;
}

/**
 * Приглашение в свой бюджет.
 *
 * Письмо не отправляем: почтовый сервис — отдельная история со своими
 * настройками и деньгами. Достаточно сказать человеку самому, что его ждут:
 * он войдёт через Google и окажется внутри.
 */
function openInviteSheet() {
  const link = el('input', { class: 'input', type: 'text', readonly: true, value: t('invite.preparing') });

  const copy = el('button', { class: 'btn btn--primary' }, t('common.copy'));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link.value);
      toastOk(t('invite.copied'));
    } catch {
      // Буфер обмена закрыт (бывает в старых браузерах) — выделяем текст руками.
      link.select();
      toastError(t('invite.copyManually'));
    }
  });

  openSheet({
    title: t('invite.title'),
    body: [
      el('div', { class: 'field' }, [
        el('label', { class: 'field__label' }, t('invite.link')),
        link,
      ]),
      el('p', { class: 'hint' }, t('invite.hint')),
      el('button', {
        class: 'btn btn--ghost btn--wide',
        style: 'margin-top:12px',
        onclick: async () => {
          try {
            link.value = await resetInviteLink(state.family);
            toastOk(t('invite.resetDone'));
          } catch {
            toastError(t('invite.resetFailed'));
          }
        },
      }, t('invite.reset')),
    ],
    footer: [
      el('button', { class: 'btn btn--ghost', onclick: closeSheet }, t('common.close')),
      copy,
    ],
  });

  inviteLink(state.family)
    .then((url) => { link.value = url; })
    .catch(() => { link.value = ''; toastError(t('invite.createFailed')); });
}
