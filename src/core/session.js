/**
 * Текущая семья.
 *
 * Раньше она была одна и её номер лежал в config.js. Теперь у каждого
 * пользователя своя, и номер известен только после входа — держим его здесь,
 * чтобы сервисы данных не таскали его через все вызовы.
 */

let familyId = null;

export function setFamilyId(id) {
  familyId = id || null;
}

export function getFamilyId() {
  if (!familyId) throw new Error('Семья ещё не загружена');
  return familyId;
}

export function hasFamily() {
  return Boolean(familyId);
}
